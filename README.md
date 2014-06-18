# spritz: A pretty simple web server framework

`spritz` is a really simple framework for dealing with `http` request/response stuff

# Installing

        npm install spritz

# Some examples

	var
	    spritz = require('spritz');

	// Start
	spritz.start({port:8090});

	// Listen on homepage
	spritz.on('/',function(req,res){
	    res.writeHead(200,{});
	    res.end('Aperol o Campari?');
	});
	spritz.on(/x/,function(req,res){
	    spritz.text(req,res,'Soda?');
	});
	spritz.on('/passwd',function(req,res){
	    spritz.staticfile(req,res,"/etc/passwd");
	});
	spritz.on('/json',function(req,res){
	    spritz.json(req,res,{some:"json",other:1});
	});
