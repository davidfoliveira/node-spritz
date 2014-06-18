"use strict";

var
	cluster = require('cluster'),
	disabledMods = {};


function logger(prefix,enabled) {

	disabledMods[prefix] = !enabled;

	return {
		_prefix: prefix,
		info: info,
		INFO: INFO,
		warn: warn,
		WARN: WARN,
		error: error,
		ERROR: ERROR,
		critical: critical,
		CRITICAL: CRITICAL,
		split: split,
		_log: _log,
		_LOG: _LOG
	};

}

function info() {
	this._log("INFO:  "+_comp(this._prefix||caller()),arguments);
}
function INFO() {
	this._LOG("INFO:  "+_comp(this._prefix||caller()),arguments);
}

function warn() {
	this._log("WARN:  "+_comp(this._prefix||caller()),arguments);
}
function WARN() {
	this._LOG("WARN:  "+_comp(this._prefix||caller()),arguments);
}

function error() {
	this._log("ERROR: "+_comp(this._prefix||caller()),arguments);
}
function ERROR() {
	this._LOG("ERROR: "+_comp(this._prefix||caller()),arguments);
}

function critical() {
	this._log("CRIT:  "+_comp(this._prefix||caller()),arguments);
}
function CRITICAL() {
	this._LOG("CRIT:  "+_comp(this._prefix||caller()),arguments);
}

function split() {
	this._log("","");
}

function _log(msg,args) {
	if ( disabledMods[this._prefix] )
		return;
	this._LOG(msg,args);
}
function _LOG(msg,args) {
	var _args = Array.prototype.slice.call(args, 0);
	_args.unshift(msg);

	if ( cluster.isMaster ) {
		_args.unshift("MASTER:\t");
		console.log.apply(console,_args);
	}
	else
		process.send({fn:'console.log',args: _args})
}

function _comp(str) {

	var
		nIndent = str.match(/\//) ? str.match(/\//g).length : 0,
		indent = "";

	for ( var x = 0 ; x < nIndent ; x++ )
		indent += " ";

	str = indent+"["+str+"]";
	while ( str.length < 50 )
		str += " ";
	return str;
}


function caller() {

	try {
		this.x.y++;
	}
	catch(e){
		if ( e.stack == null )
			return "????";

		var
			stackParts = e.stack.split("\n");

		for ( var x = 1 ; x < stackParts.length ; x++ ) {
			if ( stackParts[x].match(/^ *at *\w+\.(\w+)?.*?\/((?:lib|bin).*?)\.js:\d+:\d+\) *$/) || stackParts[x].match(/^() *at *.*?\/((?:lib|bin).*?)\.js:\d+:\d+\s*/) ) {
				var
//					fn = RegExp.$1,
					comp = RegExp.$2;

				if ( comp ) {
					if ( comp != "lib/log" ) {
						comp = comp.replace(/^lib\//,"").replace(/\//g,".");
						return comp;
					}
				}
			}
		}
		return "MAIN";
	}

	return "_";

}


// Self object

exports._log = _log;
exports._LOG = _LOG;
exports.info = info;
exports.INFO = INFO;
exports.warn = warn;
exports.WARN = WARN;
exports.error = error;
exports.ERROR = ERROR;
exports.critital = critical;
exports.CRITICAL = CRITICAL;

exports.split = split;
exports.logger = logger;
