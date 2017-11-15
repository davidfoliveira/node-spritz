# spritz: A pretty simple web server framework

`spritz` is a really simple framework for dealing with `http` request/response stuff


# Installing

	npm install spritz


# Available functions

- _spritz_.**start**(options[, callback]): Starts a new instance of an HTTP server based on the supplied options;

  The available options are:
   * proto: The protocol to use on our server (the currently supported protocols are: http, https, fastcgi) - defaults to `http`;
   * address: The network address to bind on (either an IP address or a UNIX domain socket patch) - defaults to `0.0.0.0`;
   * port: The port number to bind on - defaults to `8080`;
   * processes: The number of processes to pre-fork - defaults to `1`;
   * mimes: An object containing the `Content-type` to use for file each extension - defaults to a builtin pre-initialized list.

  The options are still going to be passed to `createServer()` so all the node https server options are supported.

- _spritz_.**use**(extension): Loads a certain _spritz_ extension (i.e: middlewares, template engines, custom functions, etc...);

- _spritz_.**on**(routePath|regExp|statusCode|hook[, options], callback): Declares a spritz route or status handler and its callback;

  The first argument can be:
   * A string containing the exact path of the route. I.e.: `'/about/'`;
   * A regular expression containing a pattern for the route. The captured groups will be available via the `RegExp` object as ususal. I.e.: `/^\/articles\/(\d+)/`;
   * A status code, in case we want to declare a status handler. I.e.: `404`;
   * A hook name, started by the '#' (hash) sign, in case we want to declare a hook handler. Check the hooks section below;


  The available options (for route handlers) are:
   * method - The method on what this route applies to - defaults to `GET`;
   * dontReadPOSTData: true - To not read the POST data from the request (in case we want to use `spritz.proxy()` on this request);
   * auth - A basic authentication rule. Check the basic authentication section below.


  The callback will always get `(request, response)` as arguments.

- _spritz_.**auth**(routePath|regExp, authRule) - Defines an authentication rule for a certain route path or regular expression. Check the basic authentication section below.

- _spritz_.**text**(req, res, text[[, statusCode, [headers], [callback]]]) - Returns a text string as a response for a certain request;

- _spritz_.**json**(req, res, someObject[[, statusCode, [headers], [callback]]]) - Returns the serialized JSON content of an object as a response for a certain request;

- _spritz_.**staticfile**(req, res, filePath[[, statusCode, [headers], [callback]]]) - Returns the content of a file as a response for a certain request;

- _spritz_.**proxy**(req, res, host|url[[, port, [options], [callback]]]) - Proxies the current request to another host or URL;

  The port argument defaults to `80`;

  The available options are:
   * proto - The protocol of the request to send to the remote server - defaults to `http`;
   * method - The method of the request to send to the remote server - defaults to the current request method;
   * path - The path of the request to send to the remote server - defaults to the current request path;
   * headers - The headers of the request to send to the remote request - default to the current request headers;
   * timeout - A request timeout for the request to send to the remote server (in milliseconds);
   * onError - A error handler callback;
   * onTimeout - A timeout handler callback;


# Hooks

The available hooks are:
- #setroute - Called when a route is declared (synchronous);
- #arrive - Right after a request arrives (asynchronous);
- #readheaders - After the headers of a request are read (asynchronous);
- #read - After a request is read (asynchronous);
- #findroute - After finding (or not) the matching route for a request (asynchronous);
- #beforewritehead - Before writing the headers of a response (asynchronous);
- #beforewritedata - Bebore writing the content of a response (asynchronous);
- #beforefinish - Before finishing to handle a request and sending its response (asynchronous);
- #finish - After finishing to handle a request and sending its response (asynchronous).

Hooks declared in UPPERCASE (i.e.: `#SETROUTE`) via `spritz.on()` will be declared as global and will be used in every spritz server instance.


# Basic authentication

Basic authentication is supported as a built-in feature. Authentication rules can be specified either via `spritz.auth('/some_route', someRule)` or `spritz.on('/some_route', {auth: someRule}, ...)`.

An authentication rule should always contain a `realm` property and either a username/password pair or a `check` function which is responsible to verify if the supplied user/pass pair is valid.

Examples of authentication rules:

- `{realm: 'Authentication required', username: 'capo', password: 'dei capi'}`

- `{realm: 'Authentication required', check: function(user, pass, callback) {return callback(user+' '+pass == 'capo dei capi');}}`


# Some code examples

	var
	    spritz = require('spritz');
	
	// Start (with so many processes as CPU cores)
	spritz.start({
	    port: 8090,
	    processes: require('os').cpus().length
	});
	
	
	// Listen on a static route
	spritz.on('/', function(req, res){
	    // Answer
	    spritz.text(req, res, 'Aperol o Campari?', 200);
	});
	
    // Answer with a JSON
	spritz.on('/json', function(req, res){
	    spritz.json(req, res, {some: "json", other: 1});
	});
	
	// Listen on a RegExp based url pattern.
	spritz.on(/^\/(x.*)/, function(req, res){
	    // console.log("User asked for ", RegExp.$1);
	    // Answer with a text. Status code and headers are optional
	    spritz.text(req, res, 'Soda?', 200, {'content-type':'text/plain'});
	});

	// Listen on a static route only for POST
	spritz.on('/post', {method:"POST"}, function(req, res){
	    // Send a JSON with the POST arguments and files
	    spritz.json(req, res, {args: req.POSTargs, files: req.POSTfiles});
	});
	
	// Listen on a static route. Tell to not read the POST data, so it will be proxied.
	spritz.on('/npm/', {dontReadPOSTData:true}, function(req, res){
	    // Proxy the request (both syntaxes are supported)
	    spritz.proxy(req, res, "https://www.npmjs.org/");
	//  spritz.proxy(req, res, "127.0.0.1", 9999, {proto: "http", timeout: 2000});
	});

	// Status handler
	spritz.on(404, function(req, res){
	    spritz.text(req, res, '404 - Cosa vuole, signore?', 404);
	});
	spritz.on(200, function(req, res){
	    console.log("Prego...");
	});


	// Set a hook
	spritz.on('#arrive', function(req, res, args, callback){
	    console.log('Got a request to '+req.url);
	    return callback();
	});

	// Use a (template) module
	spritz.use(require('spritz-jstemplate'));
	spritz.on('/use-a-template/', function(req, res){
	    spritz.template(req, res, 'template.jst', {some: 'value', other: 'value'});
	});

	// Set an authentication rule for a specific URL pattern (pattern is optional)
	//spritz.auth(/^\/pass/, {check: function(u, p, cb){ return cb(null, u=="capo" && p=="dei capi"); }});
	spritz.on(/passwd/, { auth: {username: "capo", password: "dei capi"}}, function(req, res){
	    // Answer with a file. Status code and headers are optional
	    // console.log("Serving /etc/passwd to "+req.authUser);
	    spritz.staticfile(req, res, "/etc/passwd", 200, {'content-type': 'text/plain'});
	});
