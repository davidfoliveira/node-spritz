"use strict";

/*
  Spritz Web server framework - based on web module for SAPO Meta/Cache

  Version: 0.1
  Author: David Oliveira <d.oliveira@prozone.org>
 */

var

	fs		= require('fs'),
	cluster		= require('cluster'),
	http		= require('http'),
	https		= require('https'),
	qs		= require('querystring'),
	formidable	= require('formidable'),

	log		= require('./log').logger('web',true),

	reqSeq		= 0,
	routes		= {},
	rxRoutes	= [];

// Start
exports.start = function(opts,handler){

	var
		self = this,
		args = Array.prototype.slice.call(arguments, 0),
		numProcs,
		workers = [];

	// Get and validate arguments
	if ( typeof opts == "function" ) {
		handler = opts;
		opts = null;
	}
	if ( handler == null )
		handler = function(){};
	if ( !opts )
		opts = { port: 8080, address: "0.0.0.0" };
	self._opts = opts;

	// Defaults
	if ( !opts.mimes )
		opts.mimes = { 'html': 'text/html', 'htm': 'text/html', 'js': 'text/javascript', 'css': 'text/css', 'gif': 'image/gif', 'jpg': 'image/jpeg', 'png': 'image/png' }; 
	if ( !opts.processes )
		opts.processes = 1;

	log.info("Starting...");
	// Cluster support
	numProcs = (opts.processes || 1);
	if ( numProcs > 1 ) {
		if ( cluster.isMaster ) {
			process.title = "SAPO Meta/Cache API Cluster master";
			log.info("Launching "+numProcs+" childs...");
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

			log.info("Launched "+numProcs+" childs");
			cluster.on('exit',function(worker,code,signal){
				log.error("Process #"+worker.process.pid+" died (signal "+signal+")");
			});
		}
		else {
			process.title = "SAPO Meta/Cache API Cluster process";
			return self.startServer(opts,handler);
		}
	}
	else
		return self.startServer(opts,handler);

};


// Stop
exports.stop = function(handler){

	log.info("Stopping...");
};


// Send a static file
exports.staticfile = function(req,res,filename,status,headers) {

	var
		self = this,
		ext = "unknown";

	// Remove unsafe stuff
	filename = filename.replace(/\.\./,"").replace(/\/+/,"/");
	// He's asking for a directory? We don't serve directories..
	if ( filename.match(/\/$/) )
		filename += "index.html";
	// Get the extension for sending the propper mime type
	if ( filename.match(/\.(\w+)$/) )
		ext = RegExp.$1;

//	log.info("Serving static file "+filename);
	fs.stat(filename, function(err, stat) {
		if ( err ) {
			if ( err.code == "ENOENT" ) {
				res.writeHead(404,'Not found');
				res.end("Not found");
				return _log(req,res,9);
			}
			res.writeHead(500,'Internal server error');
			res.end('Internal server error: '+JSON.stringify(err));
			return _log(req,res,length);
		}

		var
			expires = new Date();

		// Send
		res.writeHead(status||200, _merge({
			'content-type':		(self._opts.mimes[ext] || 'text/plain'),
			'content-length':	stat.size,
			'date':			new Date().toUTCString()
		},headers));

		// Send file
 		fs.createReadStream(filename).pipe(res);
 		return _log(req,res,stat.size);
	});

};

exports.text = function(req,res,content,status,headers) {

	var
		length =  Buffer.byteLength(content,'utf8');

	res.writeHead(status||200, _merge({
		'content-type':		'text/plain; charset=utf-8',
		'content-length':	length,
		'date':			new Date().toUTCString()
	},headers));
	res.end(content);
	return _log(req,res,length);

};

exports.json = function(req,res,content,status,headers,pretty) {

	var
		strfyArgs = [content],
		content;

	if ( pretty )
		strfyArgs.push(null,4);

	// Build JSON content
	content = JSON.stringify.apply(null,strfyArgs);

	// JSONP ?
	if ( req.args.callback )
		content = req.args.callback.toString() + "(" + content + ");";

	return this.text(req,res,content,status,_merge({"content-type":"application/json; charset=utf-8"},headers));

};

exports.proxy = function(req,res,hostOrURL,port,opts){

	var
		args = Array.prototype.slice.call(arguments, 0),
		timeout,
		fired = false,
		_opts = {};

	// Get the arguments
	req = args.shift();
	res = args.shift();
	hostOrURL = args.shift();
	opts = args.pop();
	port = args.shift();

	// Options with defaults
	_opts = _merge({
		proto:   "http",
		host:    hostOrURL,
		port:    port,
		path:    req.url,
		headers: req.headers || {}
	},opts||{});

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
		pres.pipe(res);
		_log(req,res,pres.headers['content-length']||'??');
	});
	preq.on('error',function(e){
		if ( _opts.onError )
			return _opts.onError(e);
		res.writeHead(503,{'content-type':'text/plain; charset=UTF-8'});
		res.end('503 - Gateway error: '+e.toString());
		_log(req,res,19);
	});
	req.pipe(preq);

};



// Internal methods

// Start the HTTP server
exports.startServer = function(opts,handler){

	var
		self = this;

	// Our router
	self.on = function(r,opts,reqHandler){
		var
			args = Array.prototype.slice.call(arguments, 0);

		// Get arguments
		r = args.shift();
		reqHandler = args.pop();

		// Merge options with the defaults
		opts = _merge({
			method: "GET",
			handler: reqHandler
		},args.shift()||{});

		// Register the route on the right list
		if ( r instanceof RegExp )
			rxRoutes.push([r,opts]);
		else
			routes[opts.method.toUpperCase()+" ! "+r] = opts;
	};

	// Start server
	self._server = http.createServer(function(req,res) {
		handleRequest(req,res);
	});
	if ( opts.port ) {
		self._server.listen(opts.port || 8080,opts.address || "0.0.0.0");
		log.info("Listening on "+(opts.address || "0.0.0.0")+":"+(opts.port||8080));
	}
	else if ( opts.address && opts.address.match(/\//) ) {
		self._server.listen(opts.address);
		log.info("Listening on "+opts.address+" UNIX domain socket");
	}
	else {
		log.warn("Don't know how to listen");
	}

};


// Handle a request
var handleRequest = function(req,res) {

	var
		self = this,
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
	if ( req.url.match(/^(.*?)\?(.*)$/) ) {
		req.originalURL = req.url;
		req.url = RegExp.$1;
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
				try { req.POSTjson = JSON.parse(buf); } catch(ex){ log.error("Error parsing POST JSON: ",ex); }
			}
			else {
				req.POSTargs = qs.parse(buf);
				if ( req.POSTargs['json'] )
					try { req.POSTjson = JSON.parse(req.POSTargs['json']); } catch(ex){  log.error("Error parsing POST JSON: ",ex); }
			}

			return handler(null,req);
		});
	}

};

// Route a request
var route = function(req,res) {

	var
		self = this,
		routeOpts;

	// String rules
	if ( routes[req.method+" ! "+req.url] != null ) {
		routeOpts = routes[req.method+" ! "+req.url];
	}

	// RegExp rules
	else {
		for ( var x = 0 ; x < rxRoutes.length ; x++ ) {
			if ( req.url.match(rxRoutes[x][0]) && rxRoutes[x][1].method.toUpperCase() == req.method ) {
				routeOpts = rxRoutes[x][1];
				break;
			}
		}
	}

	// Still no handler? 404...
	if ( !routeOpts ) {
		var ans = { error: 'No route for this request type' };
		return exports.json(req,res,ans,404);
	}

	// Read POST data ?
	_if ( !routeOpts.dontReadPOSTData,
		function(next){
			readPOSTData(req,next);
		},
		function(err){
			if ( err )
				console.log("[spritz] Error reading request POST data: ",err);

			// Call the route handler
			return routeOpts.handler(req,res);
		}
	);

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

//	log.info("Serving result of template "+filename+".tt");
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

		res.writeHead(status||200,_merge({
			'content-type':		'text/html; charset=utf-8',
			'content-length':	length
		},headers));
		res.end(output);
		return _log(req,res,length);
	});

};
*/

var _log = function(req,res,length) {
	var
		timeSpent = new Date().getTime() - req.xConnectDate.getTime();

	process.stdout.write(req.xRemoteAddr+(req.xDirectRemoteAddr?"/"+req.xDirectRemoteAddr:"")+" - "+req.xRequestID+" ["+req.xConnectDate.toString()+"] \""+req.method+" "+(req.originalURL || req.url)+" HTTP/"+req.httpVersionMajor+"."+req.httpVersionMajor+"\" "+res.statusCode+" "+(length||"-")+" "+(timeSpent / 1000).toString()+"\n");
}
var _merge = function(a,b){
	var o = {};
	if ( a != null ) {
		for ( var p in a )
			o[p.toLowerCase()] = a[p];
	}
	if ( b != null ) {
		for ( var p in b )
			o[p.toLowerCase()] = b[p];
	}
	return o;
};
var _if = function(c,a,b) {
	return c ? a(b) : b();
};
