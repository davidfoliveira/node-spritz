var
	spritz = require('../spritz');

// Start
spritz.start({port:8090,processes:(require('os').cpus().length)});

// Listen on homepage
spritz.on('/',function(req,res){
	res.writeHead(200,{});
	res.end('Aperol o Campari?');
});
spritz.on(/^\/x/,function(req,res){
	spritz.text(req,res,'Soda?');
});

spritz.auth(/^\/pass/,{check:function(u,p,cb){ return cb(null,u=="capo" && p=="di tutti capi"); }});
spritz.on(/passwd/,function(req,res){
	spritz.staticfile(req,res,"/etc/passwd");
});

spritz.on(/json/,function(req,res){
	spritz.json(req,res,{some:"json",other:1});
});
spritz.on('/post',{method:"POST"},function(req,res){
	console.log("GOT a POST request: ",req.headers);
	spritz.json(req,res,{postData:req.POSTargs});
});
spritz.on('/npm/',{dontReadPOSTData:true},function(req,res){
	spritz.proxy(req,res,"https://www.npmjs.org/");
//	spritz.proxy(req,res,"127.0.0.1",9999,{proto:"http",timeout: 2000});
});

// Status handlers
spritz.on(404,function(req,res){
	spritz.text(req,res,'404 - Cosa vuole, signore?',404);
});
//spritz.on(200,function(req,res){
//	console.log("Prego...");
//});
