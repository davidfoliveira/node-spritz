"use strict";

/*
  Spritz Web server framework
  Version: 0.5.0
  Author: David Oliveira <d.oliveira@prozone.org>
 */


var
	fs			= require('fs'),
	http		= require('http'),
	https		= require('https'),
	cluster 	= require('cluster'),
	qs			= require('querystring'),
	formidable	= require('formidable');


// Our data (from the default/first server)
exports.routes			= {};
exports.rxRoutes		= [];
exports.statusRoutes	= {};
exports.reqSeq			= 0;
exports.hooks			= {
	'setroute':			[],		// sync  | 
	'arrive':			[],		// async | done
	'readheaders':		[],		// async | done
	'read':				[],		// async | done
	'findroute':		[],		// async | done
	'beforewritehead':	[],		// async | done
	// writehead ->				// async | done
	'beforewritedata':	[],		// async | done
	// writedata ->				// async | done
	'beforefinish':		[],		// async | done
	'finish':			[]		// async | done
};
exports.globalHooks		= {};

// Create a new server instance
exports.newServer = function(){

	var
		self = this,
		newServer

	// Clone the current object
	newServer = self.cloneServer();

	// Reset some data
	newServer.routes		= {};
	newServer.rxRoutes		= [];
	newServer.statusRoutes	= {};
	newServer.reqSeq		= 0;

	// Cleanup hooks (copy them from globalHooks or initialize them)
	for ( var h in newServer.hooks )
		newServer.hooks[h] = exports.globalHooks[h] ? exports.globalHooks[h].slice(0) : [];

	// Delete newServer()
	delete newServer.newServer;

	// Return it
	return newServer;

};


// Clone a currently existing server instance
exports.cloneServer = function(){

	var
		self = this;

	// Clone the current object and return it
	return _merge(self,{});

};


// Use a certain (or a list of) module(s)
exports.use = function(modules,args) {

	var
		self = this,
		_mods = (modules instanceof Array) ? modules : [modules];

	// Initialize all the modules
	_mods.forEach(function(mod){
		if ( typeof mod.init == "function" )
			mod.init.apply(self,[args||{}]);
	});

};


// Register a hook
exports.hook = function(name,callback){

	var
		self = this;

	if ( !name || !callback )
		return;
	if ( name.match(/^request(.+)$/i) )
		name = RegExp.$1;
	if ( name == "writehead" )
		name = 'beforewritedata';
	else if ( name == "writedata" )
		name = 'beforefinish';

	// Hook does not exit? Ciao!
	if ( !self.hooks[name.toLowerCase()] )
		return;

	// Register the callback
	self.hooks[name.toLowerCase()].push(callback);

	// Uppercase hooks are 'global' (to being set on new servers)
	if ( name.toUpperCase() == name ) {
		name = name.toLowerCase();
		if ( !self.globalHooks[name] )
			self.globalHooks[name] = [];
		// Register the callback
		self.globalHooks[name].push(callback);
	}

};


// Fires a hook
var _fireHook = function(self,name,args,callback) {

	var
		sentBeforeHook = (args.length > 1 && args[1]._sent),
		sentDuringHook;

	// No callbacks, ciao!
	if ( !self.hooks[name] || self.hooks[name].length == 0 ) {
		// Process the request normally
		return callback(null);
	}

	// Add the 'self' instance
	args.unshift(self);

	// Call the hooks
	return series(self.hooks[name],args,function(err,done){
		if ( err ) {
//			console.log("Error calling '"+name+"' hooks: ",err);
			return self.json(args[0],args[1],{error:err},500);
		}

		// It's done, or the answer was sent during hook... finito!
		sentDuringHook = !sentBeforeHook && (args.length > 1 && args[1]._sent);
		if ( done || sentDuringHook )
			return;

		// Continue processing
		return callback(err);
	});

};

// Fires a syncronous hook
var _fireSyncHook = function(self,name,args,callback) {

	var
		sentBeforeHook = (args.length > 1 && args[1]._sent),
		sentDuringHook;

	// No callbacks, ciao!
	if ( !self.hooks[name] || self.hooks[name].length == 0 ) {
		// Process the request normally
		return callback(null);
	}

	// Call the hooks
	for ( var x = 0 ; x < self.hooks[name].length ; x++ ) {
		var hook = self.hooks[name][x];
		var done = hook.apply(self,args);
		if ( typeof done == "boolean" && done )
			return true;
	}

	return false;

};


// Start the server
exports.start = function(opts,callback){

	var
		self = this,
		args = Array.prototype.slice.call(arguments, 0),
		numProcs,
		workers = [];

	// Get and validate arguments
	if ( typeof opts == "function" ) {
		callback = opts;
		opts = null;
	}
	if ( !callback )
		callback = function(){};
	if ( !opts )
		opts = { port: 8080, address: "0.0.0.0" };
	self._opts = opts;

	// Defaults
	if ( !opts.mimes )
		opts.mimes = { 'html': 'text/html', 'htm': 'text/html', 'js': 'text/javascript', 'css': 'text/css', 'gif': 'image/gif', 'jpg': 'image/jpeg', 'png': 'image/png' }; 
	if ( !opts.processes )
		opts.processes = 1;

	_log_info("Starting...");

	// Cluster support
	numProcs = (opts.processes || 1);
	if ( numProcs > 1 ) {
		if ( cluster.isMaster ) {
			process.title = "Spritz MASTER";
			_log_info("Launching "+numProcs+" childs...");
			for ( var x = 0 ; x < numProcs ; x++ )
				workers.push(cluster.fork());

			// When a message arrives
			workers.forEach(function(worker){
				worker.on('message', function(msg) {
					if ( typeof(msg) == "object" && msg.fn == "console.log" ) {
						msg.args.unshift("#"+worker.process.pid+":\t");
						console.log.apply(console,msg.args);
					}
				});
			});

			_log_info("Launched "+numProcs+" childs");
			cluster.on('exit',function(worker,code,signal){
				_log_error("Process #"+worker.process.pid+" died (signal "+signal+")");
			});

			// Some fake methods
//			self.on = function(){};
		}
		else {
			process.title = "Spritz child process";
			return _startServer(self,opts,callback);
		}
	}
	else
		return _startServer(self,opts,callback);

};

// Start the HTTP server
var _startServer = function(self,opts,callback){

	var
		iface,
		_handleRequest = function(req,res){
			handleRequest(self,req,res);
		};


	// Create the server
	iface = (opts.proto == 'fastcgi')	? require('fastcgi-server') :
			(opts.proto == 'https')		? https	:
			http;
	self._server =	(opts.proto == "https")		? https.createServer(opts,_handleRequest) :
					(opts.proto == "fastcgi")	? require('fastcgi-server').createServer(_handleRequest) :
					http.createServer(_handleRequest);

	// Listen
	if ( opts.port == null )
		opts.port = (opts.proto == "https") ? 443 : 8080;
	if ( opts.port ) {
		self._server.listen(opts.port || 8080,opts.address || "0.0.0.0");
		_log_info("Listening on "+(opts.address || "0.0.0.0")+":"+opts.port);
	}
	else if ( opts.address && opts.address.match(/\//) ) {
		self._server.listen(opts.address);
		_log_info("Listening on "+opts.address+" UNIX domain socket");
	}
	else {
		_log_warn("Don't know how to listen");
	}

};

// Handle a request
var handleRequest = function(self,req,res) {

	var
		now = new Date();

	// Request just arrived, fire the hook
	return _fireHook(self,'arrive',[req,res,{}],function(){

		// Request related values
		req._cType = req.headers['content-type'] ? req.headers['content-type'].toString().replace(/;.*/g,"") : "unknown/unknown";
		req.xRequestID = (self.reqSeq++) + "-" + process.pid.toString() + "-" + now.getYear()+now.getMonth()+now.getDay()+now.getHours()+now.getMinutes();
		req.xConnectDate = now;
		req.xRemoteAddr = req.connection.remoteAddress || ((req.client && req.client._peername) ? req.client._peername.address : "0.0.0.0");
		if ( req.xRemoteAddr == "127.0.0.1" && req.headers['x-forwarded-for'] && req.headers['x-forwarded-for'].match(/^(\d{1,3}\.){3}\d{1,3}$/) ) {
			req.xDirectRemoteAddr = req.xRemoteAddr;
			req.xRemoteAddr = req.headers['x-forwarded-for'];
		}

		// Request arguments
		req.args = {};
	    req.originalURL = req.url;
		if ( req.url.match(/^(.*?)\?(.*)$/) ) {
			req.url = RegExp.$1;
			req.urlNoArgs = RegExp.$1;
			req.args = qs.parse(RegExp.$2);
		}

		// POST data reader
		req.readPOSTData = function(cb){cb(null,{});};
		if ( req.method == "POST" ) {
			req.readPOSTData = function(cb){
				return readPOSTData(this,function(err){
					return cb(err,this.POSTdata);
				});
			};
		}

		// Finished read request
		return _fireHook(self,'readheaders',[req,res,{}],function(){

			// Route request
			return route(self,req,res);

		});
	});

};

// Read data from POST and parse it
var readPOSTData = function(req,callback) {

	// POST data already read, don't do it again
	if ( req._readPOSTData )
		return callback(null,req);
	req._readPOSTData = true;

	// multipart/form-data or just a regular urlencoded form?
	if ( req._cType.match(/^multipart\/form\-data/) ) {
		try {
			var
				form = new formidable.IncomingForm();

			form.parse(req,function(err,args,files){
				if ( err )
					return callback(err,false);

				req.POSTargs = args;
				req.POSTfiles = files;
				return callback(null,req);
			});
		}
		catch(ex) {
			return callback(ex,null);
		}
	}
	else {
		req.setEncoding("utf-8");
		var buf = "";
		req.on('data',function(chunk){ buf += chunk; });
		req.on('end',function(){
			if ( req._cType == "application/json" ) {
				try { req.POSTjson = JSON.parse(buf); } catch(ex){ _log_error("Error parsing POST JSON: ",ex); }
			}
			else {
				req.POSTargs = qs.parse(buf);
				if ( req.POSTargs['json'] )
					try { req.POSTjson = JSON.parse(req.POSTargs['json']); } catch(ex){  _log_error("Error parsing POST JSON: ",ex); }
			}
			return callback(null,req);
		});
	}

};


// Generic route handler
exports.on = function(r,opts,reqHandler){

	var
		self = this,
		args = Array.prototype.slice.call(arguments, 0);

	// Get arguments
	r = args.shift();
	reqHandler = args.pop();

	// Is it a hook ? Set it using the hook()
	if ( typeof r == "string" && r.match(/^#(\w+)$/) )
		return self.hook(RegExp.$1,reqHandler);


	// Merge options with the defaults
	opts = _merge({
//		method: "GET",
		handler: reqHandler,
		expr:    r
	},args.shift()||{});

	// Fire the setroute hook
	if ( _fireSyncHook(self,'setroute',[opts]) ) {
		// Setting route was aborted
		return;
	}

	// Is it a RegExp ?
	if ( r instanceof RegExp ) {
		// Register the route on the RegExp route list
		self.rxRoutes.push([r,opts]);
	}
	else if ( typeof r == "string" ) {
		// Register the route on the string route list
		self.routes[(opts.method?opts.method.toUpperCase()+" ! ":"")+r] = opts;
	}
	else if ( typeof r == "number" ) {
		r = r.toString();
		if ( !self.statusRoutes[r] )
			self.statusRoutes[r] = [];
		// Register the route on the status route list
		self.statusRoutes[r].push(opts);
	}
	else
		throw new Error("Don't know what to do with route '"+r+"'");

};


// Route a request
var route = function(self,req,res) {

	var
		routeOpts,
		matchedRoute;

	// String routes
	if ( self.routes[req.method+" ! "+req.url] != null ) {
		routeOpts = self.routes[req.method+" ! "+req.url];
	}
	else if ( self.routes[req.url] ) {
		routeOpts = self.routes[req.url];
	}

	// RegExp routes
	else {
		for ( var x = 0 ; x < self.rxRoutes.length ; x++ ) {
			if ( req.url.match(self.rxRoutes[x][0]) && self.rxRoutes[x][1].method.toUpperCase() == req.method ) {
				matchedRoute = self.rxRoutes[x][0];
				routeOpts = self.rxRoutes[x][1];
				break;
			}
		}
	}

	// Still no handler? 404...
	if ( !routeOpts ) {
		res.statusCode = 404;
		// Fire read hook
		return _fireHook(self,'read',[req,res,{}],function(){
			return routeStatus(self,req,res,false);
		});
	}

	// Read POST data ?
	return _if ( !routeOpts.dontReadPOSTData,
		function(next){
			req.readPOSTData(next);
		},
		function(err){
			if ( err )
				_log_error("Error reading request POST data: ",err);

			// Fire read hook
			return _fireHook(self,'read',[req,res,{}],function(){

				// Fire find route hook
				return _fireHook(self,'findroute',[req,res,{route: routeOpts}],function(){

					// Set the RegExp object
					if ( matchedRoute )
						req.url.match(self.rxRoutes[x][0]);

					// Call the route handler
					return routeOpts.handler(req,res);
				});
			});
		}
	);

};


// Route a status occurrence
var routeStatus = function(self,req,res,alreadyServed,headers) {

	var
		ans,
		routes;

	// Inside a status route handler ?
	if ( req.onStatusRouteH )
		return;

	// Already served ? Mark it on request, so future route handlers can take this in consideration
	req.served = alreadyServed;

	// Do we have a status handler ?
	routes = self.statusRoutes[res.statusCode.toString()];
	if ( routes ) {
		req.onStatusRouteH = true;
		return _fireHook(self,'findroute',[req,res,{route:{handler: route,expr:res.statusCode}}],function(){
			var
				handlers = routes.map(function(r){return r.handler});
			// Call the handlers
			return series(handlers,[self,req,res],function(err,done){});
		});
	}

	// Already served ? Ciao!
	if ( alreadyServed )
		return;

	// No.. default status handler
	ans =	(res.statusCode == 404) ? 	{ error: 'No route for this request type' } :
			(res.statusCode == 401) ?	{ warn:  'Authentication required' } :
			(res.statusCode >= 400) ?	{ error: 'Got error '+res.statusCode } :
										{ info:  'Returning status '+res.statusCode };

	// Something to answer? Answer..!
	if ( ans && !alreadyServed )
		return self.json(req,res,ans,res.statusCode,headers);

};


// Write the head of an HTTP response
var _writeHead = function(self,req,res,status,headers,callback){

	var
		headObj = {status: status, headers: headers};

	return _fireHook(self,'beforewritehead',[req,res,headObj],function(){
		res.writeHead(headObj.status,headObj.headers);
		// Mark on the answer that we sent it
		res._sent = true;
		return callback();
	});

}

// Write the head of an HTTP response
var _writeData = function(self,req,res,data,end,callback){

	var
		dataObj = { data: data, end: end };

	return _fireHook(self,'beforewritedata',[req,res,dataObj],function(){

		// Just writing...
		if ( !dataObj.end ) {
			res.write(dataObj.data);
			return callback();
		}

		// Write and end
		return _fireHook(self,'beforefinish',[req,res,dataObj],function(){
			res.end(dataObj.data);

			// Finish
			return _fireHook(self,'finish',[req,res,{}],function(){
				return callback();
			});
		});
	});

}


// Answer with a text string
exports.text = function(req,res,content,status,headers,callback) {

	var
		self = this,
		length = Buffer.byteLength(content,'utf8'),
		_headers = _merge({
			'content-type':		'text/plain; charset=utf-8',
			'content-length':	length,
			'date':				new Date().toUTCString()
		},headers,true);

	// Set the status code
	res.statusCode = status || 200;

	// Send data
	return _writeHead(self,req,res,res.statusCode,_headers,function(){
		return _writeData(self,req,res,content,true,function(){
			// Log
			_access_log(req,res,length);

			// Report status
			routeStatus(self,req,res,true);

			// Call the callback
			if ( callback )
				callback(null,true);
		});
	});

};

// Answer with JSON
exports.json = function(req,res,content,status,headers,pretty,callback) {

	var
		strfyArgs = [content];

	if ( pretty && typeof pretty == "function" ) {
		callback = pretty;
		pretty = false;
	}
	if ( pretty )
		strfyArgs.push(null,4);

	// Build JSON content
	content = JSON.stringify.apply(null,strfyArgs);

	// JSONP ?
	if ( req.args.callback )
		content = req.args.callback.toString() + "(" + content.replace(/[\u00a0\u2000-\u203f]/g,"") + ");";

	// Send the data
	this.text(req,res,content,status,_merge({"content-type":"application/json; charset=utf-8"},headers,true));

	// Call the callback
	if ( callback )
		callback(null,true);

};

// Proxy the request
exports.proxy = function(req,res,hostOrURL,port,opts,callback){

	var
		self = this,
		args = Array.prototype.slice.call(arguments, 0),
		url,
		timeout,
		fired = false,
		docSize = 0,
		_opts = {};

	// Get the arguments
	req			= args.shift();
	res			= args.shift();
	hostOrURL	= args.shift();
	opts		= args.pop();
	port		= args.shift();

	// What url ?
	url = (req.url === req.urlNoArgs) ? req.originalURL : req.url;

	// Options with defaults
	_opts = _merge({
		proto:   "http",
		host:    hostOrURL,
		port:    port,
		path:    url,
		headers: req.headers || {}
	},opts||{},true);

	// Trying to proxy a POST request with already read POST data ?
	if ( req.method == "POST" && req._readPOSTData ) {
		var err = new Error("Trying to proxy a POST request with POST data already read. Please supply dontReadPOSTData:true on route options.");
		if ( _opts.onError )
			return _opts.onError(err);
		else
			throw err;
	}

	// Validate and load host/url
	if ( !hostOrURL )
		throw new Error("No host/url to send the request");
	// Host:port
	else if ( hostOrURL.match(/:(\d+)$/) ) {
		_opts.port = parseInt(RegExp.$1);
		_opts.host = hostOrURL.replace(/:.*$/,"");
		_opts.headers.host = _opts.host;
	}
	// URL
	else if ( hostOrURL.match(/^https?:\/\//) ) {
		var u = require('url').parse(hostOrURL);
		_opts.proto = u.protocol.replace(/:.*$/,"");
		_opts.host = u.hostname;
		_opts.headers.host = u.hostname;
		_opts.port = u.port;
		_opts.path = u.path;
	}

	// No port ? defaults to the default protocol port
	if ( !_opts.port )
		_opts.port = (_opts.proto == "https" ? 443 : 80);

	var
		proto = (_opts.proto == "https") ? https : http,
		preq = proto.request({
			host:    _opts.host,
			port:    _opts.port,
			method:  req.method,
			headers: _opts.headers || req.headers,
			path:    _opts.path
		});

	// Timeout event
	if ( _opts.timeout ) {
		timeout = setTimeout(function(){
			preq.abort();
			fired = true;
			if ( _opts.onTimeout )
				return _opts.onTimeout();
			return _writeHead(self,req,res,502,{'Content-type':'text/plain; charset=UTF-8'},function(){
				return _writeData(self,req,res,'502 - Gateway timeout :-(',true);
			});
		},_opts.timeout);
	}

	// On response arrive
	preq.on('response',function(pres){
		if ( fired )
			return;
		if ( timeout )
			clearTimeout(timeout);
		return _writeHead(self,req,res,pres.statusCode,pres.headers,function(){
			if ( typeof opts.outputFilter == "function" ) {
				var allData = null;
				pres.on('data',function(data){
					var newB = new Buffer(((allData != null)?allData.length:0)+data.length);
					if ( allData != null )
						allData.copy(newB,0,0,allData.length);
					data.copy(newB,(allData != null)?allData.length:0,0,data.length);
					allData = newB;
				});
				pres.on('end',function(){
					var d = opts.outputFilter(allData,req,res,preq,pres);
					if ( d == null )
						d = allData;
					docSize = d.length;
					return _writeData(self,req,res,d,true,function(){
						// Run the callback
						if ( callback )
							callback(null,true);

						// Log
						return _access_log(req,res,pres.headers['content-length']||docSize||'??');
					});
				});
			}
			else {
				var pr = pres.pipe(res);
				pr.on('end',function(){
					// Run the callback
					if ( callback )
						callback(null,true);

					// Log
					_access_log(req,res,pres.headers['content-length']||docSize||'??');
				});
			}
		});
	});
	preq.on('error',function(e){
		if ( _opts.onError )
			return _opts.onError(e);
		return _writeHead(self,req,res,503,{'content-type':'text/plain; charset=UTF-8'},function(){
			return _writeData(self,req,res,'503 - Gateway error: '+e.toString(),true,function(){
				req.abort();
				return _access_log(req,res,19);
			});
		});
	});
	if ( req.headers && req.headers['content-length'] )
		req.pipe(preq);
	else
		preq.end();

};


// Template
exports.template = function(req,res,file,data,status,headers,callback){

	throw new Exception("No templating module was loaded. Use spritz.use()");

};


/*
 * Internals
 */

// Logging functions
var _log_info = function() {
        return _log("INFO:  ",arguments);
}
var _log_warn = function() {
        return _log("WARN:  ",arguments);
}
var _log_error = function() {
        return _log("ERROR: ",arguments);
}
var _log = function(type,args) {
	var
		_args = [type],
		_keys;

	// Convert arguments into array - old style
	_keys = args ? Object.keys(args) : [];
	_keys.forEach(function(num){
		_args.push(args[num]);
	});

	// Master, send directly to console
	if ( cluster.isMaster ) {
		_args.unshift("MASTER:\t");
		console.log.apply(console,_args);
	}
	// Children send via cluster messaging system
	else {
		// Send to the master process, so we avoid problems with many processes writing on the same file
		process.send({fn:'console.log',args: _args});
	}
}

// Access log
var _access_log = function(req,res,length) {
	var
		timeSpent = new Date().getTime() - req.xConnectDate.getTime();

	_log(req.xRemoteAddr+(req.xDirectRemoteAddr?"/"+req.xDirectRemoteAddr:"")+" - "+req.xRequestID+" ["+req.xConnectDate.toString()+"] \""+req.method+" "+(req.originalURL || req.url)+" HTTP/"+req.httpVersionMajor+"."+req.httpVersionMajor+"\" "+res.statusCode+" "+(length||"-")+" "+(timeSpent / 1000).toString());
};

// Merge 2 objects
var _merge = function(a,b,lcProps){
	var o = {};
	if ( a != null ) {
		for ( var p in a )
			o[lcProps?p.toLowerCase():p] = a[p];
	}
	if ( b != null ) {
		for ( var p in b )
			o[lcProps?p.toLowerCase():p] = b[p];
	}
	return o;
};

// Asyncronous if
var _if = function(c,a,b) {
	return c ? a(b) : b();
};


// Call a list of callbacks in series (could eventually be replaced by async.series or async.mapSeries but we don't want to add more dependencies)
var series = function(fns,args,callback){
	var
		_self	= args.shift(),
		_fns	= fns.slice(),
		_next	= function(){
			if ( !_fns.length )
				return callback(null,false);
			_fns.shift().apply(_self,args);
		};

	// Add as last argument our function return handler
	args.push(function(err,stop,done){
		if ( err )
			return callback(err,false);
		return (stop || done) ? callback(null,done) : setImmediate(_next);
	});

	return _next();
};


// Load all the built-in modules
exports.use(require('./modules'));

