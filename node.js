import rand from 'rand'
import { node as nodes } from './servers.js'
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

async function sendRequest(id, method, timeout, params = [], attempt = 0, nodeArray = shuffleArray(nodes)){
	const controller = new AbortController;
	const { signal } = controller;
	let pointer;
	if(timeout !== null) pointer = setTimeout(() => controller.abort(), timeout);
	try{
		return await fetch(nodeArray.pop(), {
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

const blockchainAPI = new Proxy(Object.create(null), {
	get(_, method){
		if(!_[method]) Object.assign(_, {
			[method]: logged(() => withName(method, async (...params) => {
				const id = rand(12);
				const data = await sendRequest(id, method, requestTimeout, params);
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
