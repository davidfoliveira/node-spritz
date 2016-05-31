var
	spritz = require('../spritz');
//	spritz = require('../spritz').start({port:8090});

// Start
//spritz.start({port:8090,processes:(require('os').cpus().length)});
spritz.start({port:8090});

// Listen on homepage
spritz.on('/',function(req,res){
	res.writeHead(200,{});
	res.end('Aperol o Campari?');
});
spritz.on(/^\/(x.*)/,function(req,res){
	console.log("User asked for ",RegExp.$1);
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
spritz.on('/sapo/',{dontReadPOSTData:true},function(req,res){
	spritz.proxy(req,res,"http://www.sapo.pt/");
//	spritz.proxy(req,res,"127.0.0.1",9999,{proto:"http",timeout: 2000});
});

spritz.on('/cache/',{cache:true},function(req,res){
	console.log("Processing request "+req.url);
	setTimeout(function(){
		spritz.text(req,res,'Tuo spritz è pronto!');
	},1000);
});

// Status handlers
spritz.on(404,function(req,res){
	req.xLoggingFlags.push("X");
	spritz.text(req,res,'404 - Cosa vuole, signore?',404);
});
//spritz.on(200,function(req,res){
//	console.log("Prego...");
//});
