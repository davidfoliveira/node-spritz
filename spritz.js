"use strict";

/*
  Spritz Web server framework - based on web module for SAPO Meta/Cache

  Version: 0.4.0
  Author: David Oliveira <d.oliveira@prozone.org>
 */

var
	fs				= require('fs'),
	cluster			= require('cluster'),
	http			= require('http'),
	https			= require('https'),
	qs				= require('querystring'),
	formidable		= require('formidable'),

	reqSeq			= 0,
	routes			= {},
	rxRoutes		= [],
	statusRoutes	= {},
	authRules		= [],
	cacheRules		= [],
	templEngines	= {},
	objCache		= {},
	self			= exports;


// Start
exports.start = function(opts,handler){

	var
		args = Array.prototype.slice.call(arguments, 0),
		numProcs,
		workers = [];

	// Get and validate arguments
	if ( typeof opts == "function" ) {
		handler = opts;
		opts = null;
	}
	if ( !handler )
		handler = function(){};
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
			self.on = function(){};
			self.auth = function(){};
		}
		else {
			process.title = "Spritz child process";
			return self.startServer(opts,handler);
		}
	}
	else
		return self.startServer(opts,handler);

};


// Stop
exports.stop = function(handler){
	_log_info("Stopping...");
	self._server = null;
};


// Send a static file
exports.staticfile = function(req,res,filename,status,headers,callback) {

	var
		ext = "unknown";

	// Remove unsafe stuff
	filename = filename.replace(/\.\./,"").replace(/\/+/,"/");
	// He's asking for a directory? We don't serve directories..
	if ( filename.match(/\/$/) )
		filename += "index.html";
	// Get the extension for sending the propper mime type
	if ( filename.match(/\.(\w+)$/) )
		ext = RegExp.$1;

//	_log_info("Serving static file "+filename);
	fs.stat(filename, function(err, stat) {
		if ( err ) {
			if ( err.code == "ENOENT" ) {
				res.statusCode = 404;
				callback(err,null);
				return routeStatus(req,res,false);
			}
			res.writeHead(500,'Internal server error');
			res.end('Internal server error: '+JSON.stringify(err));
			callback(err,null);
			return _access_log(req,res,length);
		}

		var
			expires = new Date(),
			_headers = _merge({
				'content-type':		(self._opts.mimes[ext] || 'text/plain'),
				'content-length':	stat.size,
				'date':				new Date().toUTCString()
			},headers,true);

		// Send
		res.statusCode = status || 200;
		res.writeHead(res.statusCode,_headers);

		// Set the cache entry
		if ( req.cacheKey ) {
			objCache[req.cacheKey] = {
				status:		res.statusCode,
				headers:	headers,
				stat:		stat,
				file:		filename
			};
		}

		// Send file
 		var pr = fs.createReadStream(filename).pipe(res);
		if ( callback ) {
			pr.on('end',function(){
				callback(null,true);
			});
		}
		_access_log(req,res,stat.size);

		// Report status
		return routeStatus(req,res,true);
	});

};
exports.file = exports.staticfile;

exports.text = function(req,res,content,status,headers,callback) {

	var
		length = Buffer.byteLength(content,'utf8'),
		_headers = _merge({
			'content-type':		'text/plain; charset=utf-8',
			'content-length':	length,
			'date':				new Date().toUTCString()
		},headers,true);

	// Set the status code and send data
	res.statusCode = status || 200;
	res.writeHead(res.statusCode,_headers);
	res.end(content);

	// Request has a cache key? We need to cache it
	if ( req.cacheKey ) {
		objCache[req.cacheKey] = {
			status:		res.statusCode,
			headers:	_headers,
			content:	content,
			length:		length
		};
	}
	_access_log(req,res,length);

	// Report status
	routeStatus(req,res,true);

	// Call the callback
	if ( callback )
		callback(null,true);

};

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

exports.proxy = function(req,res,hostOrURL,port,opts,callback){

	var
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
			res.writeHead(502,{'Content-type':'text/plain; charset=UTF-8'});
			res.end('502 - Gateway timeout :-(');
		},_opts.timeout);
	}

	// On response arrive
	preq.on('response',function(pres){
		if ( fired )
			return;
		if ( timeout )
			clearTimeout(timeout);
		res.writeHead(pres.statusCode, pres.headers);

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
				res.write(d);
				res.end();

				// Run the callback
				if ( callback )
					callback(null,true);

				// Log
				_access_log(req,res,pres.headers['content-length']||docSize||'??');
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
	preq.on('error',function(e){
		if ( _opts.onError )
			return _opts.onError(e);
		res.writeHead(503,{'content-type':'text/plain; charset=UTF-8'});
		res.end('503 - Gateway error: '+e.toString());
		req.abort();
		_access_log(req,res,19);
	});
	if ( req.headers && req.headers['content-length'] )
		req.pipe(preq);
	else
		preq.end();

};



// Internal methods

// Start the HTTP server
exports.startServer = function(opts,handler){

	// Our router
	self.on = function(r,opts,reqHandler){
		var
			args = Array.prototype.slice.call(arguments, 0),
			auth;

		// Get arguments
		r = args.shift();
		reqHandler = args.pop();

		// Merge options with the defaults
		opts = _merge({
//			method: "GET",
			handler: reqHandler
		},args.shift()||{});

		// Authentication option on the route will be registered on the authRules list
		if ( typeof opts.auth != "undefined" ) {
			// Add to the authentication rules
			authRules.push(buildAuthRule(r,opts.auth,opts.method));
		}

		// Cache option on the route will be registered on the cacheRules list
		if ( opts.cache ) {
			// Add to the cache rules
			cacheRules.push(buildCacheRule(r,opts.cache,opts.method));
		}

		// Register the route on the right list
		if ( r instanceof RegExp )
			rxRoutes.push([r,opts]);
		else if ( typeof r == "string" )
			routes[(opts.method?opts.method.toUpperCase()+" ! ":"")+r] = opts;
		else if ( typeof r == "number" )
			statusRoutes[r.toString()] = opts;
		else
			throw new Error("Don't know what to do with route '"+r+"'");

	};

	// Authentication
	self.auth = function(r,opts){
		var
			args = Array.prototype.slice.call(arguments, 0);

		// Get the arguments
		opts	= args.pop();
		r		= args.shift();

		// Add to the authentication rules
		authRules.push(buildAuthRule(r,opts));
	};

	// Cache
	self.cache = function(r,opts){
		var
			args = Array.prototype.slice.call(arguments, 0);

		// Get the arguments
		opts	= args.pop() || true;
		r		= args.shift();

		// Add to the cache rules
		cacheRules.push(buildCacheRule(r,opts));
	};

	// Start server
	var iface = (opts.interface == 'fastcgi') ? require('fastcgi-server') : http;
	self._server = iface.createServer(function(req,res) {
		handleRequest(req,res);
	});
	if ( opts.port ) {
		self._server.listen(opts.port || 8080,opts.address || "0.0.0.0");
		_log_info("Listening on "+(opts.address || "0.0.0.0")+":"+(opts.port||8080));
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
var handleRequest = function(req,res) {

	var
		now = new Date();

	// Request related values
	req._cType = req.headers['content-type'] ? req.headers['content-type'].toString().replace(/;.*/g,"") : "unknown/unknown";
	req.xRequestID = (reqSeq++) + "-" + process.pid.toString() + "-" + now.getYear()+now.getMonth()+now.getDay()+now.getHours()+now.getMinutes();
	req.xConnectDate = now;
	req.xRemoteAddr = req.connection.remoteAddress || (req.client && req.client._peername) ? req.client._peername.address : "0.0.0.0";
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
	if ( req.method == "POST" ) {
		req.readPOSTData = function(cb){
			return readPOSTData(req,function(err){
				return cb(err,req.POSTdata);
			});
		};
	}

	// Route request
	return route(req,res);

};

// Read data from POST and parse it
var readPOSTData = function(req,handler) {

	// POST data already read, don't do it again
	if ( req._readPOSTData )
		return handler(null,req);
	req._readPOSTData = true;

	// multipart/form-data or just a regular urlencoded form?
	if ( req._cType.match(/^multipart\/form\-data/) ) {
		try {
			var
				form = new formidable.IncomingForm();

			form.parse(req,function(err,args,files){
				if ( err )
					return handler(err,false);

				req.POSTargs = args;
				req.POSTfiles = files;
				return handler(null,req);
			});
		}
		catch(ex) {
			return handler(ex,null);
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
			return handler(null,req);
		});
	}

};

// Route a request (first, check for the authentication)
var route = function(req,res) {

	var
		auth,
		authUser = '',
		authPass = '',
		cache;

    // Find for a matching authorization rule
	for ( var x = 0 ; x < authRules.length; x++ ) {
		var rule = authRules[x];
		if ( req.url.match(rule.pattern) && (!rule.method || req.method == rule.method) ) {
			auth = rule;
			break;
		}
	}
	if ( auth && !auth.check )
		auth = null;

	// Find for a matching cache rule
	for ( var x = 0 ; x < cacheRules.length; x++ ) {
		var rule = cacheRules[x];
		if ( req.url.match(rule.pattern) && (!rule.method || req.method == rule.method) ) {
			cache = rule;
			break;
		}
	}

	// Authenticate
	return _if ( auth,
		function(next) {
			// Parse the Authorization header
			if ( req.headers && req.headers.authorization && req.headers.authorization.match(/^basic +(.+)/i) ) {
				var b64Auth = new Buffer(RegExp.$1,'base64');
				if ( b64Auth.toString().match(/^([^:]+):(.*)$/) ) {
					authUser = RegExp.$1;
					authPass = RegExp.$2;
				}
			}

			// Check the credentials
			return auth.check(authUser,authPass,next);
		},
		function(err,valid) {
			if ( err ) {
				_log_error("Error checking user authentication: ",err);
				res.statusCode = 500;
				return routeStatus(req,res,false);
			}

			// Authentication error
			if ( auth && !valid ) {
				if ( authUser || authPass )
					_log_info("Authentication failure on '"+req.url+"' with '"+authUser+"' and '"+authPass+"'");

				res.statusCode = 401;
				return routeStatus(req,res,false,{'www-authenticate':'Basic realm="'+auth.realm+'"'});
			}

			// Set the authenticated user name
			req.authUser = authUser;

			// Check cache
			if ( cache ) {
				req.cacheKey = cache.keyGenerator(req,res);
				req.cacheRule = cache;
				if ( req.cacheKey && objCache[req.cacheKey] && _sendCached(req,res,objCache[req.cacheKey]) )
					return;
			}

			// Let go
			return _route(req,res);
		}
	);

};

// Return the cache data
var _sendCached = function(req,res,cacheObj) {

	// Write the head
	res.writeHead(cacheObj.status,cacheObj.headers);

	// Pipe content from a file
	if ( cacheObj.file ) {
 		fs.createReadStream(cacheObj.file).pipe(res);
		_access_log(req,res,stat.size,true);
	}
	// Write content
	else if ( cacheObj.content != null ) {
		res.end(cacheObj.content);
		_access_log(req,res,cacheObj.length,true);
	}
	// Serve it.. but not from cache
	else
		return false;

	return true;

};

// Route a request
var _route = function(req,res) {

	var
		routeOpts,
		matchedRoute;

	// String routes
	if ( routes[req.method+" ! "+req.url] != null ) {
		routeOpts = routes[req.method+" ! "+req.url];
	}
	else if ( routes[req.url] ) {
		routeOpts = routes[req.url];
	}

	// RegExp routes
	else {
		for ( var x = 0 ; x < rxRoutes.length ; x++ ) {
			if ( req.url.match(rxRoutes[x][0]) && rxRoutes[x][1].method.toUpperCase() == req.method ) {
				matchedRoute = rxRoutes[x][0];
				routeOpts = rxRoutes[x][1];
				break;
			}
		}
	}

	// Still no handler? 404...
	if ( !routeOpts ) {
		res.statusCode = 404;
		return routeStatus(req,res,false);
	}

	// Read POST data ?
	_if ( !routeOpts.dontReadPOSTData,
		function(next){
			readPOSTData(req,next);
		},
		function(err){
			if ( err )
				_log_error("Error reading request POST data: ",err);

			// Set the RegExp object
			if ( matchedRoute )
				req.url.match(rxRoutes[x][0]);

			// Call the route handler
			return routeOpts.handler(req,res);
		}
	);

};

// Route a status occurrence
var routeStatus = function(req,res,alreadyServed,headers) {

	var
		ans;

	// Inside a status route handler ?
	if ( req.onStatusRouteH )
		return;

	// Already served ? Mark it on request, so future route handlers can take this in consideration
	req.served = alreadyServed;

	// Do we have a status handler ?
	if ( statusRoutes[res.statusCode.toString()] ) {
		req.onStatusRouteH = true;
		return statusRoutes[res.statusCode.toString()].handler(req,res);
	}

	// Already served ? Ciao!
	if ( alreadyServed )
		return;

	// No.. default status handler
	ans =	(res.statusCode == 404) ? { error: 'No route for this request type' } :
		(res.statusCode == 401) ?	{ warn:  'Authentication required' } :
		(res.statusCode >= 400) ?	{ error: 'Got error '+res.statusCode } :
									{ info:  'Returning status '+res.statusCode };

	// Something to answer? Answer..!
	if ( ans && !alreadyServed )
		return self.json(req,res,ans,res.statusCode,headers);

};

// Build an authentication rule based on the authentication options
var buildAuthRule = function(pattern,authOpts,method) {

	if ( authOpts == null )
		authOpts = { check: null };

	// Auth is a function, put her on the right place
	if ( typeof(auth) == "function" )
		authOpts = { check: authOpts };

	// No realm? Set a default one
	if ( !authOpts.realm )
		authOpts.real = 'Authentication required';

	// Didn't specify a check function but specified a username and password, build the function
	if ( !authOpts.check && authOpts.username && authOpts.password ) {
		authOpts.check = function(u,p,callback){
			return callback(null,(u == authOpts.username && p == authOpts.password));
		};
	}

	// Has a URL pattern ? If no.. default
	authOpts.pattern = (pattern || /.*/);

	// Has a method ? Yes.. make sure it's uppercase
	if ( authOpts.method || authOpts.method )
		authOpts.method = (method || authOpts.method).toUpperCase();

	return authOpts;

};

// Build a cache rule based on the cache options
var buildCacheRule = function(pattern,cacheOpts,method) {

	// Cache is a function, put her on the right place
	if ( typeof cacheOpts == "function" )
		cacheOpts = { keyGenerator: cacheOpts };
	else if ( typeof cacheOpts == "boolean" )
		cacheOpts = { keyGenerator: cacheOpts ? function(req,res){return req.originalURL;} : null };
	else if ( typeof cacheOpts == "number" )
		cacheOpts = { expireIn: cacheOpts };
	else
		throw new Error("Unknown/Unsupported cache settings: ",cacheOpts);

	if ( !cacheOpts.keyGenerator )
		cacheOpts.keyGenerator = function(req,res){return req.originalURL;};
	if ( !cacheOpts.expireIn )
		cacheOpts.expireIn = 60;	// 1 minute

	// Has a URL pattern ? If no.. default
	cacheOpts.pattern = (pattern || /.*/);

	// Has a method ? Yes.. make sure it's uppercase
	if ( method || cacheOpts.method )
		cacheOpts.method = (method || cacheOpts.method).toUpperCase();

	return cacheOpts;

};

/*
exports.template = function(req,res,filename,args,status,headers){

	var
		Template = require('tt2').Template,
		template = new Template({
			INCLUDE_PATH: "view",
			FILTERS: {
				JSON:		JSON.stringify,
				JSONSIMPLE:	function(data) { return JSON.stringify(data).replace(/"(\w+)":/g,"$1:") },
				number:		function(data) { return data.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") }
			}
		});

//	_log_info("Serving result of template "+filename+".tt");
	template.process(filename+".tt",args,function(err,output){
		if ( err ) {
			res.writeHead(500,{'content-type':'text/html; charset=utf-8'});
			return res.end("Error: "+JSON.stringify(err));
		}
		if ( output == null ) {
			res.writeHead(500,{'content-type':'text/html; charset=utf-8'});
			return res.end("Error: "+JSON.stringify(err));
		}

		var
			length = Buffer.byteLength(output,'utf8');

		// Send the output
		res.statusCode = status || 200;
		res.writeHead(res.statusCode,_merge({
			'content-type':		'text/html; charset=utf-8',
			'content-length':	length
		},headers,true));
		res.end(output);

		// Log
		_access_log(req,res,length);

		// Report status
		return routeStatus(req,res,true);
	});

};
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
