"use strict";

/*
  Spritz Web server framework
  Version: 0.5.2
  Author: David Oliveira <d.oliveira@prozone.org>
 */


var
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
exports._fireHook = function(self,name,args,callback) {

	var
		sentBeforeHook = (args.length > 1 && args[1]._sent),
		sentDuringHook,
		_allHooks = (self.hooks[name] || []).slice(0),
		req = (args.length > 0) ? args[0] : null;

	// Does the request have a hook declaration ?
	if ( req && req._route && typeof req._route['#'+name] == "function" )
		_allHooks.push(args[0]._route['#'+name]);

	// No hooks? Ciao!
	if ( _allHooks.length == 0 ) {
		// Process the request normally
		return callback(null);
	}


	// Add the 'self' instance
	args.unshift(self);

	// Call the hooks
	return series(_allHooks,args,function(err,done){
		if ( err ) {
//			_log_error("Error calling '"+name+"' hooks: ",err);
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
exports._fireSyncHook = function(self,name,args,callback) {

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
exports.start = function(opts, callback){

	var
		self = this,
		args = Array.prototype.slice.call(arguments, 0),
		numProcs,
		workers = {};

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
			for ( var x = 0 ; x < numProcs ; x++ ) {
				var worker = cluster.fork();
				_workerSetup(workers,worker);
			}

			_log_info("Launched "+numProcs+" childs");
			cluster.on('exit',function(worker,code,signal){
				delete workers[worker.process.pid];
				self._log_error("Process #"+worker.process.pid+" died (signal "+signal+"). Launching other...");				
				var worker = cluster.fork();
				_workerSetup(workers,worker);
			});
		}
		else {
			process.title = "Spritz child process";
			return _startServer(self,opts,callback);
		}
	}
	else {
		return _startServer(self,opts,callback);
	}

};

// Setup a worker
var _workerSetup = function(list,worker) {

	// Add worker to the list
	list[worker.process.pid] = worker;

	// Listen for messages
	worker.on('message', function(msg) {
		if ( typeof(msg) == "object" && msg.fn == "console.log" ) {
			msg.args.unshift("#"+worker.process.pid+":\t");
			console.log.apply(console,msg.args);
		}
	});

}

// Start the HTTP server
var _startServer = function(self, opts, callback){

	var
		server,
		iface,
		_handleRequest = function(req,res){
			handleRequest(self,req,res);
		};

	self.handleRequest = _handleRequest;

	// Do we have a callback?
	if ( !callback )
		callback = function(){};

	// Decide which server module to use
	iface = (opts.proto == 'fastcgi') ? require('fastcgi-server') :
		(opts.proto == 'https')   ? https :
		http;

	// Listen
	if ( opts.port == null )
		opts.port = (opts.proto == "https") ? 443 : 8080;
	if ( opts.port ) {
		server = iface.createServer(_handleRequest).listen(opts.port || 8080,opts.address || "0.0.0.0",callback);
		_log_info("Listening on "+(opts.address || "0.0.0.0")+":"+opts.port);
	}
	else if ( opts.address && opts.address.match(/\//) ) {
		server = self.createServer(_handleRequest).listen(opts.address,callback);
		_log_info("Listening on "+opts.address+" UNIX domain socket");
	}
	else {
		_log_warn("Don't know how to listen");
	}
	return server;

};

// Handle a request
var handleRequest = function(self,req,res) {

	var
		now = new Date();

	// Request just arrived, fire the hook
	return self._fireHook(self,'arrive',[req,res,{}],function(){

		// Request related values
		req._cType = req.headers['content-type'] ? req.headers['content-type'].toString().replace(/;.*/g,"") : "unknown/unknown";
		req.xRequestID = (self.reqSeq++) + "-" + process.pid.toString() + "-" + now.getYear()+now.getMonth()+now.getDay()+now.getHours()+now.getMinutes();
		req.xConnectDate = now;
		req.xRemoteAddr = req.connection.remoteAddress || ((req.client && req.client._peername) ? req.client._peername.address : "0.0.0.0");
		if ( req.xRemoteAddr == "127.0.0.1" && req.headers['x-forwarded-for'] && req.headers['x-forwarded-for'].match(/^(\d{1,3}\.){3}\d{1,3}$/) ) {
			req.xDirectRemoteAddr = req.xRemoteAddr;
			req.xRemoteAddr = req.headers['x-forwarded-for'];
		}

		// Response related values
		res._cookies = {};
		res.setCookie = function(n,v,o) {
			res._cookies[n] = { value: v, opts: o };
		};

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
		if ( req.method == "POST" || req.method == "PUT" ) {
			req.readPOSTData = function(cb){
				return readPOSTData(self,req,function(err){
					return cb(err,self.POSTdata);
				});
			};
		}

		// The logging flags
		req.xLoggingFlags = [];

		// Finished read request
		return self._fireHook(self,'readheaders',[req,res,{}],function(){

			// Route request
			return self._route(req,res);

		});
	});

};

// Read data from POST and parse it
var readPOSTData = function(self,req,callback) {

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
				try { req.POSTjson = JSON.parse(buf); } catch(ex){ _log_error("Error parsing POST JSON: ",ex.toString(),"JSON: ",buf); }
			}
			else {
				req.POSTargs = qs.parse(buf);
				if ( req.POSTargs['json'] )
					try { req.POSTjson = JSON.parse(req.POSTargs['json']); } catch(ex){  _log_error("Error parsing POST JSON: ",ex.toString(),"JOSN: ",req.POSTargs['json']); }
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
	if ( self._fireSyncHook(self,'setroute',[opts]) ) {
		// Setting route was aborted
		return;
	}

	var routes = (r instanceof Array) ? r : [r];

	routes.forEach(function(r) {
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
	});

};


// Route a request
var _route = function(req,res) {

	var
		self = this,
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
			if ( req.url.match(self.rxRoutes[x][0]) && (!self.rxRoutes[x][1].method || (self.rxRoutes[x][1].method.toUpperCase() == req.method)) ) {
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
		return self._fireHook(self,'read',[req,res,{}],function(){
			return self._routeStatus(req,res,false);
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
			return self._fireHook(self,'read',[req,res,{}],function(){

				// Fire find route hook
				req._route = routeOpts;
				return self._fireHook(self,'findroute',[req,res,{route: routeOpts}],function(){

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
exports._route = _route;


// Route a status occurrence
var _routeStatus = function(req,res,alreadyServed,headers) {

	var
		self = this,
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
		return mapSeries(routes,self,
			function(r,next){
				return self._fireHook(self,'findroute',[req,res,{route:r}],next);
			},
			function(){
				var
					handlers = routes.map(function(r){return r.handler});

				// Call the handlers
				return series(handlers,[self,req,res],function(err,done){});
			}
		);
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
exports._routeStatus = _routeStatus;


// Write the head of an HTTP response
var _writeHead = function(self,req,res,status,headers,callback){

	var
		headObj = {status: status, headers: headers};

	return self._fireHook(self,'beforewritehead',[req,res,headObj],function(){
		res.writeHead(headObj.status,headObj.headers);
		// Mark on the answer that we sent it
		res._sent = true;
		res.statusCode = headObj.status;
		return callback();
	});

};
exports._writeHead = _writeHead;

// Write the head of an HTTP response
var _writeData = function(self,req,res,data,end,callback){

	var
		dataObj = { data: data, end: end };

	return self._fireHook(self,'beforewritedata',[req,res,dataObj],function(){

		// Just writing...
		if ( !dataObj.end ) {
			res.write(dataObj.data);
			return callback();
		}

		// Write and end
		return self._fireHook(self,'beforefinish',[req,res,dataObj],function(){
			res.end(dataObj.data);

			// Finish
			return self._fireHook(self,'finish',[req,res,{}],function(){
				return callback();
			});
		});
	});

}
exports._writeData = _writeData;

// Pipe a stream into an HTTP response
var _pipeStream = function(self,req,res,stream,callback){

	var
		pr;

	return self._fireHook(self,'beforewritedata',[req,res,stream],function(){

		// Pipe the stream
 		pr = stream.pipe(res);
		stream.on('end',function(){
			callback(null,true);
		});

	});

};
exports._pipeStream = _pipeStream;


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
			self._access_log(req,res,length);

			// Report status
			self._routeStatus(req,res,true);

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
};
exports._log		= _log;
exports._log_info	= _log_info;
exports._log_warn	= _log_warn;
exports._log_error	= _log_error;

// Access log
exports._access_log = function(req,res,length) {
	var
		timeSpent = new Date().getTime() - req.xConnectDate.getTime(),
		flags = "";

	if ( req.xLoggingFlags && req.xLoggingFlags.length > 0 )
		flags = " "+req.xLoggingFlags.join('');

	_log(req.xRemoteAddr+(req.xDirectRemoteAddr?"/"+req.xDirectRemoteAddr:"")+" - "+req.xRequestID+" ["+req.xConnectDate.toString()+"] \""+req.method+" "+(req.originalURL || req.url)+" HTTP/"+req.httpVersionMajor+"."+req.httpVersionMajor+"\" "+res.statusCode+" "+(length||"-")+" "+(timeSpent / 1000).toString()+flags);
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
exports._merge = _merge;

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

var mapSeries = function(arr,_self,itCb,fiCb){
	var
		_arr	= arr.slice(),
		_res	= [],
		_next	= function(err,res){
			if ( !_arr.length )
				return fiCb(err,_res);
			itCb.apply(_self,[_arr.shift(),function(err,res){
				if ( err )
					return fiCb(err,_res);
				_res.push(res);
				setImmediate(_next);
			}]);
		};
    return _next();
};

// Load all the built-in modules
exports.use(require('./modules'));
