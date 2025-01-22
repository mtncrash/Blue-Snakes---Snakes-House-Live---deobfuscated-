const configs = require('./configs.json');
const os = require('os');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const pLimit = require('p-limit');
const ws = require('ws');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');
const CryptoJS = require("crypto-js");
const xlsx = require('xlsx');
const readlineSync = require('readline-sync');

const limit = pLimit(configs.howManyAccountsRunInOneTime);
const proxyAgents = new Map();
const userAgents = require('user-agents');

function getRandomUserAgent() {
    const userAgent = new userAgents();
    return userAgent.toString();
}

function log(message, color = 'white') {
    console.log(colors[color](message));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getProxyAgent(proxy) {
    if (proxyAgents.has(proxy)) {
        return proxyAgents.get(proxy);
    }

    const [hostname, port, protocol] = proxy.split(':');
    const agent = protocol === 'socks5'
        ? new SocksProxyAgent(`socks5://${hostname}:${port}`)
        : new HttpsProxyAgent(`http://${hostname}:${port}`);

    proxyAgents.set(proxy, agent);
    return agent;
}

function getAccounts() {
    const accounts = fs.readFileSync('datas.txt', 'utf-8').split('\n');
    return accounts.filter(account => account.trim() !== '');
}

function getWallets() {
    const wallets = fs.readFileSync('wallets.txt', 'utf-8').split('\n');
    return wallets.filter(wallet => wallet.trim() !== '');
}

function getProxies() {
    const proxies = fs.readFileSync('proxies.txt', 'utf-8').split('\n');
    return proxies.filter(proxy => proxy.trim() !== '');
}

function getRandomProxy() {
    const proxies = getProxies();
    return proxies[Math.floor(Math.random() * proxies.length)];
}

function getRandomLineFromFile(filename) {
    const lines = fs.readFileSync(filename, 'utf-8').split('\n');
    return lines[Math.floor(Math.random() * lines.length)];
}

function getRandomHeaders() {
    const headers = {
        'User-Agent': getRandomUserAgent(),
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
    };

    if (configs.rotateProxy) {
        const proxy = getRandomProxy();
        headers['X-Forwarded-For'] = proxy.split(':')[0];
        headers['Forwarded'] = `for=${proxy.split(':')[0]}`;
    }

    return headers;
}

function getHeaders(account) {
    const headers = {
        'user-agent': account.userAgent,
        'authorization': account.token,
    };

    if (configs.rotateProxy) {
        const proxy = getRandomProxy();
        headers['X-Forwarded-For'] = proxy.split(':')[0];
        headers['Forwarded'] = `for=${proxy.split(':')[0]}`;
    }

    return headers;
}

function getSign(data, key) {
    const str = JSON.stringify(data) + key;
    const hash = CryptoJS.MD5(str).toString();
    return hash.toString().toUpperCase();
}

async function initAccount(account) {
    const wallet = getWallets().shift() || getRandomLineFromFile('wallets.txt');
    const userAgent = getRandomLineFromFile('userAgents.txt');
    const token = Buffer.from(`${wallet}:${userAgent}`).toString('base64');

    account.wallet = wallet;
    account.userAgent = userAgent;
    account.token = token;
}

async function doTask(account, task) {
    const data = {
        'address': account.wallet,
        'task': task,
        'sign': getSign({ 'address': account.wallet, 'task': task }, account.userAgent),
    };

    const response = await axios.post(
        'https://snakeshouse.live/api/doTask',
        data,
        {
            headers: getHeaders(account),
            httpsAgent: configs.rotateProxy && getProxyAgent(getRandomProxy()),
        }
    );

    if (response.data.status === 1) {
        log(`[${account.index}] Done task ${task} - ${response.data.message}`, 'green');
    } else {
        log(`[${account.index}] Error task ${task} - ${response.data.message}`, 'red');
    }
}

async function playGame(account) {
    const data = {
        'address': account.wallet,
        'sign': getSign({ 'address': account.wallet }, account.userAgent),
    };

    const response = await axios.post(
        'https://snakeshouse.live/api/playGame',
        data,
        {
            headers: getHeaders(account),
            httpsAgent: configs.rotateProxy && getProxyAgent(getRandomProxy()),
        }
    );

    if (response.data.status === 1) {
        log(`[${account.index}] Play game ${response.data.message}`, 'green');
    } else {
        log(`[${account.index}] Error game ${response.data.message}`, 'red');
    }
}

async function getDaily(account) {
    const data = {
        'address': account.wallet,
        'sign': getSign({ 'address': account.wallet }, account.userAgent),
    };

    const response = await axios.post(
        'https://snakeshouse.live/api/getDaily',
        data,
        {
            headers: getHeaders(account),
            httpsAgent: configs.rotateProxy && getProxyAgent(getRandomProxy()),
        }
    );

    if (response.data.status === 1) {
        log(`[${account.index}] Get daily ${response.data.message}`, 'green');
    } else {
        log(`[${account.index}] Error daily ${response.data.message}`, 'red');
    }
}

async function runAccount(account) {
    try {
        await initAccount(account);

        if (configs.doTasks) {
            for (const task of ['FOLLOW_TELEGRAM', 'JOIN_TELEGRAM_GROUP', 'FOLLOW_TWITTER']) {
                await doTask(account, task);
                await sleep(1000 * configs.delayEachAccount[0]);
            }
        }

        if (configs.playGames) {
            await playGame(account);
            await sleep(1000 * configs.delayEachAccount[1]);
        }

        await getDaily(account);
    } catch (error) {
        console.log(error);
        log(`[${account.index}] Error: ${error.message}`, 'red');
    }
}

async function runBot() {
    const accounts = getAccounts();
    const wallets = getWallets();
    const proxies = getProxies();

    if (accounts.length === 0) {
        log('No accounts found in datas.txt', 'red');
        return;
    }

    if (wallets.length === 0) {
        log('No wallets found in wallets.txt', 'red');
        return;
    }

    if (configs.rotateProxy && proxies.length === 0) {
        log('No proxies found in proxies.txt', 'red');
        return;
    }

    log(`Running bot with ${accounts.length} accounts, ${wallets.length} wallets, and ${proxies.length} proxies`);

    const limit = pLimit(configs.howManyAccountsRunInOneTime);

    await Promise.all(accounts.map((account, index) =>
        limit(async () => {
            account = { index: index + 1, data: account };
            await runAccount(account);
        })
    ));

    log('All accounts have been run', 'green');
}

async function main() {
    try {
        await runBot();
    } catch (error) {
        console.log(error);
        log(`Error: ${error.message}`, 'red');
    }
}

function startBot() {
    main();

    setInterval(() => {
        main();
    }, 1000 * 60 * configs.timeToRestartAllAccounts);
}

startBot();
