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



// Self methods

exports.startServer = function(opts,handler){

	var
		self = this;

	// Our router
	self.on = function(r,reqHandler){
		if ( r instanceof RegExp )
			rxRoutes.push([r,reqHandler]);
		else
			routes[r] = reqHandler;
	};

	// Start server
	self._server = http.createServer(function(req,res) {
		self.handleRequest(req,res);
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

exports.handleRequest = function(req,res) {

	var
		self = this,
		now = new Date(),
		cType = req.headers['content-type'] ? req.headers['content-type'].toString().replace(/;.*/g,"") : "unknown/unknown";

	// Request related values

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

	// POST arguments/form-data

	if ( req.method != "POST" )
		return self.route(req,res);

	// multipart/form-data or just a regular urlencoded form?

	if ( cType.match(/^multipart\/form\-data/) ) {
		try {
			var
				form = new formidable.IncomingForm();

			form.parse(req,function(err,args,files){
				if ( err )
					return handler(err,false);

				req.POSTargs = args;
				req.POSTfiles = files;
				return self._router(req,res);
			});
		}
		catch(ex) {
			return self._router(req,res);
		}
	}
	else {
		req.setEncoding("utf-8");
		var buf = "";
		req.on('data',function(chunk){ buf += chunk; });
		req.on('end',function(){
			if ( cType == "application/json" ) {
				try { req.POSTjson = JSON.parse(buf); } catch(ex){ log.error("Error parsing POST JSON: ",ex); }
			}
			else {
				req.POSTargs = qs.parse(buf);
				if ( req.POSTargs['json'] )
					try { req.POSTjson = JSON.parse(req.POSTargs['json']); } catch(ex){  log.error("Error parsing POST JSON: ",ex); }
			}

			return self.route(req,res);
		});
	}

};

exports.route = function(req,res) {

	var
		self = this;

	if ( routes[req.url] != null )
		return routes[req.url](req,res);

	// RegExp rules

	for ( var x = 0 ; x < rxRoutes.length ; x++ ) {
		if ( req.url.match(rxRoutes[x][0]) )
			return rxRoutes[x][1](req,res);
	}

	// 404
	var ans = { error: 'No route for this request type' };
	return self.json(req,res,ans,404);

};

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

exports.log = _log;
