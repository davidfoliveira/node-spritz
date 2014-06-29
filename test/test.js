var
	spritz = require('../lib/spritz');

// Start
spritz.start({port:8090});

// Listen on homepage
spritz.on('/',function(req,res){
	res.writeHead(200,{});
	res.end('Aperol o Campari?');
});
spritz.on(/^\/x/,function(req,res){
	spritz.text(req,res,'Soda?');
});
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
