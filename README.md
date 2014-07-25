# spritz: A pretty simple web server framework

`spritz` is a really simple framework for dealing with `http` request/response stuff

# Installing

        npm install spritz

# Some examples

	var
	    spritz = require('spritz');
	
	// Start (with so many processes as CPU cores)
	spritz.start({
	    port: 8090,
	    processes: require('os').cpus().length
	});
	
	
	// Listen on a static route
	spritz.on('/',function(req,res){
	    // Old style answer
	    res.writeHead(200,{});
	    res.end('Aperol o Campari?');
	});
	
	// Listen on a RegExp based url pattern.
	spritz.on(/^\/x/,function(req,res){
	    // Answer with a text. Status code and headers are optional
	    spritz.text(req,res,'Soda?',200,{'content-type':'text/plain'});
	});
	
	
	// Set an authentication rule for a specific URL pattern (pattern is optional)
	//spritz.auth(/^\/pass/,{check:function(u,p,cb){ return cb(null,u=="capo" && p=="dei capi"); }});
	spritz.on(/passwd/,{auth:{username:"capo",password:"dei capi"}},function(req,res){
	    // Answer with a file. Status code and headers are optional
	    // console.log("Serving /etc/passwd to "+req.authUser);
	    spritz.staticfile(req,res,"/etc/passwd",200,{'content-type':'text/plain'});
	});
	
	spritz.on(/json/,function(req,res){
	    // Answer with a JSON
	    spritz.json(req,res,{some:"json",other:1});
	});
	
	// Listen on a static route only for POST
	spritz.on('/post',{method:"POST"},function(req,res){
	    // Send a JSON with the POST arguments and files
	    spritz.json(req,res,{args:req.POSTargs,files:req.POSTfiles});
	});
	
	// Listen on a static route. Tell to not read the POST data, so it will be proxied.
	spritz.on('/npm/',{dontReadPOSTData:true},function(req,res){
	    // Proxy the request (both syntaxes are supported)
	    spritz.proxy(req,res,"https://www.npmjs.org/");
	//  spritz.proxy(req,res,"127.0.0.1",9999,{proto:"http",timeout: 2000});
	});

	
	// Status handler
	spritz.on(404,function(req,res){
	    spritz.text(req,res,'404 - Cosa vuole, signore?',404);
	});
	//spritz.on(200,function(req,res){
	//    console.log("Prego...");
	//});
