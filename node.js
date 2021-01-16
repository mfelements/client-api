import rand from 'rand'
import { nodes } from './servers.js'
import logged, { withName } from 'logger'

const requestTimeout = 2000,
	attemptCount = 3;

class BlockchainError extends Error{
	constructor(error){
		super(`${error.code}\n${error.message}`);
		this.name = 'BlockchainError'
	}
}

function shuffleArray(array){
	const newarr = Array.from(array);
	for (let i = newarr.length - 1; i > 0; i--){
		const j = Math.floor(Math.random() * (i + 1));
		[newarr[i], newarr[j]] = [newarr[j], newarr[i]];
	}
	return newarr
}

function getKeyByVal(obj, val){
	for(const i in obj) if(obj[i] === val) return i
}

async function rateNodes(){
	const startTime = Date.now();
	let res = [];
	const blockCounter = {};
	for(const node of shuffleArray(nodes)) res.push(Promise.all([ node, node, node ].map(node => sendRequestWithNode(node, rand(2), 'getinfo', requestTimeout).then(r => {
		if(!r || !r.result || !r.result.blocks) return null;
		const { blocks } = r.result;
		if(!blockCounter[blocks]) blockCounter[blocks] = 1;
		else blockCounter[blocks]++;
		r.requestTime = Date.now() - startTime;
		r.node = node;
		return r
	}))).then(v => v.reduce((p, c) => {
		p.requestTime += c.requestTime;
		return p
	})));
	res = (await Promise.all(res)).filter(v => v);
	const blockCountConsensusCount = Math.max(...Object.values(blockCounter));
	const blockCountConsensus = +getKeyByVal(blockCounter, blockCountConsensusCount);
	res = res.filter(r => (r.result.blocks === blockCountConsensus));
	res = res.sort((a, b) => (a.requestTime - b.requestTime));
	return res.map(v => v.node)
}

const _ratedNodes = rateNodes();

async function sendRequest(id, method, timeout, params = [], attempt = 0, nodeArray = shuffleArray(nodes)){
	const controller = new AbortController;
	const { signal } = controller;
	let pointer;
	if(timeout !== null) pointer = setTimeout(() => controller.abort(), timeout);
	const currentNode = nodeArray.pop();
	try{
		if(!currentNode){
			attempt = attemptCount - 1;
			throw new Error
		}
		return await fetch(currentNode, {
			method: 'POST',
			body: JSON.stringify({
				jsonrpc: '2.0',
				method,
				params,
				id,
			}),
			signal,
		}).then(r => {
			if(timeout !== null) clearTimeout(pointer);
			return r.json()
		})
	} catch(e){
		if(++attempt === attemptCount) throw withName('NetworkError', new Error(`cannot connect to any node after ${attemptCount} attempts`));
		return sendRequest(id, method, timeout, params, attempt, nodeArray)
	}
}

async function sendRequestWithNode(node, id, method, timeout, params = []){
	try{
		return sendRequest(id, method, timeout, params, 2, [ node ])
	} catch(e){
		return null
	}
}

const blockchainAPI = new Proxy(Object.create(null), {
	get(_, method){
		if(!_[method]) Object.assign(_, {
			[method]: logged(() => withName(method, async (...params) => {
				const id = rand(12);
				const data = await sendRequest(id, method, requestTimeout, params, 0, await _ratedNodes);
				if(data.error) throw new BlockchainError(data.error);
				if(data.id !== id) throw withName('SystemError', new Error('returned info does not match requested one'));
				return data.result
			}))
		});
		return _[method]
	}
});

const isBin = /[\x00-\x08\x0E-\x1F]/;

function parseNVSValue(value){
	const res = {};
	const lines = value.split('\n');
	let line;
	while(line = lines.shift()){
		if(isBin.test(line)){
			const splitted = line.split('=');
			res[splitted.shift()] = splitted.join('=') + lines.join('\n');
			return res
		}
		if(line){
			const splitted = line.split('=');
			res[splitted.shift()] = splitted.join('=')
		}
	}
	return res
}

export async function getNames(prefix){
	if(!prefix) throw new Error('There is no prefix specified');
	prefix += ':';
	const names = await blockchainAPI.name_scan(prefix, 999999999);
	const res = {};
	for(const { name, value } of names.filter(({ name }) => name.startsWith(prefix))){
		res[name.slice(prefix.length)] = parseNVSValue(value)
	}
	return res
}

export default blockchainAPI
