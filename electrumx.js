import { electrumx as nodes } from './servers.min.js'
import logged, { withName } from '@mfelements/logger'
import rand from '@mfelements/rand'

const requestMap = Object.create(null),
	reconnectTimeout = 100,
	reconnectAttempts = 3;

class ElectrumError extends Error{
	constructor({ code, message }){
		super(`code ${code}: ${message}`)
	}
}

const _ws = {
	_value: undefined,
	_loaded: false,
	_listeners: [],
	_errListeners: [],
	then(callback, errCallback){
		if(this._loaded) try{ callback(this._value) } catch(e){}
		else this._listeners.push(callback);
		this._errListeners.push(errCallback)
	}
};

function processAPIAnswer({ data }){
	const { id, result, error } = JSON.parse(data);
	if(requestMap[id]){
		const { resolve, reject } = requestMap[id];
		delete requestMap[id];
		if(error) reject(new ElectrumError(error));
		else resolve(result)
	}
}

async function getTransport(){
	if(!_ws._value) connect();
	return _ws
}

function closeTransport(e){
	delete _ws._value;
	const errListeners = _ws._errListeners;
	_ws._errListeners = [];
	errListeners.forEach(v => v(e));
	_ws._loaded = false
}

function connect(){
	/*!
	 * TODO: node rating and intelligent usage
	 */
	const ws = new WebSocket(nodes[0]);
	_ws._value = ws;
	ws.onopen = () => {
		_ws._loaded = true;
		_ws._listeners.forEach(callback => callback(ws));
		_ws._listeners = []
	};
	ws.onclose = e => closeTransport(new Error('Cannot establish websocket communication. Code: ' + e.code));
	ws.onmessage = processAPIAnswer
}

export function reconnect(timeout = reconnectTimeout, doNotClose = false){
	_ws._loaded = false;
	try{ if(!doNotClose) _ws._value.close() } catch(e){}
	delete _ws._value;
	setTimeout(connect, timeout)
}

function serializeRequest(method, params, id){
	return JSON.stringify({
		jsonrpc: '2.0',
		id,
		method,
		params,
	})
}

function sendRequest(method, params){
	return new Promise(upperResolve => {
		const promise = new Promise(async (resolve, reject) => {
			const id = rand();
			requestMap[id] = { resolve, reject };
			try{
				const transport = await getTransport();
				transport.send(serializeRequest(method, params, id));
				upperResolve({ promise })
			} catch(error){
				upperResolve({ error })
			}
		})
	})
}

// this function is needed to not to overflow call stack with calling sendRequest from sendRequest directly
async function sendRequestWithAutoreconnect(method, params){
	let promise, error, reconnects = 0;
	while({ promise, error } = await sendRequest(method, params), !promise && reconnects++ !== reconnectAttempts) reconnect();
	if(error) throw error;
	return promise
}

function getMethodCaller(method){
	return logged(() => withName('electrumX.' + method, async (...args) => sendRequestWithAutoreconnect(method, args)))
}

function nextLevel(method){
	return new Proxy(getMethodCaller(method), {
		get(_, nextMethod){
			if(_[nextMethod] === undefined){
				return nextLevel(`${method}.${nextMethod}`)
			} else return _[nextMethod]
		},
	})
}

export default new Proxy(Object.create(null), {
	get(_, method){
		return nextLevel(method)
	}
})
