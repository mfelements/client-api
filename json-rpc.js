import rand from '@mfelements/rand'

class NamedError extends Error{
	constructor(message){
		super(message);
		this.name = Object.getPrototypeOf(this).constructor.name || 'Error';
	}
}

class ErrorWithCode extends NamedError{
	constructor({ code, message }){
		super(message);
		this.code = code;
	}
}

export class JSONRPCError extends ErrorWithCode{}

export class NetworkError extends ErrorWithCode{}

const resolvers = {};

const currentQueues = {};

function timeoutErr(){
	return new NetworkError({ code: -1, message: 'Timeout exceeded' });
}

function initQueue(url){
	currentQueues[url] = [];
	currentQueues[url].timeout = 0;
}

function rejectAll(queue, reason){
	queue.forEach(({ id }) => {
		const { reject } = resolvers[id];
		delete resolvers[id];
		reject(reason);
	});
}

function sendQueue(url){
	const queue = currentQueues[url];
	initQueue(url);
	const { timeout } = queue;
	const requestData = queue.length === 1 ? queue[0] : queue;
	const controller = new AbortController;
	const { signal } = controller;
	let rejectHandler;
	if(timeout) rejectHandler = setTimeout(() => {
		rejectAll(queue, timeoutErr());
		controller.abort();
	}, timeout);
	let res;
	try{
		res = await fetch(url, {
			method: 'POST',
			body: JSON.stringify(requestData),
			signal,
		}).then(v => {
			clearTimeout(rejectHandler);
			return v.json();
		});
	} catch(e){
		rejectAll(queue, e);
	}
	for(const r of Array.isArray(res) ? res : [res]){
		const { resolve, reject } = resolvers[r.id];
		delete resolvers[r.id];
		if(r.error) reject(JSONRPCError(r.error));
		else resolve(r.result);
	}
}

export default function request(url, method, params, timeout = null){
	return new Promise((resolve, reject) => {
		const id = rand(2);
		resolvers[id] = { resolve, reject };
		if(!currentQueues[url]) initQueue(url);
		currentQueues[url].push({
			jsonrpc: '2.0',
			method,
			params,
			id,
		});
		if(timeout !== null){
			if(timeout > currentQueues[url].timeout) currentQueues[url].timeout = timeout;
			setTimeout(() => reject(timeoutErr()), timeout);
		}
		clearTimeout(currentQueues[url].handler);
		currentQueues[url].handler = setTimeout(() => sendQueue(url))
	})
}
