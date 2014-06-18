var
	spritz = require('../lib/spritz');

// Start
spritz.start({port:8090});

// Listen on homepage
spritz.on('/',function(req,res){
	res.writeHead(200,{});
	res.end('Aperol o Campari?');
});
spritz.on(/x/,function(req,res){
	res.writeHead(200,{});
	res.end('Soda?');
});
spritz.on(/passwd/,function(req,res){
	spritz.staticfile(req,res,"/etc/passwd");
});
spritz.on(/json/,function(req,res){
	spritz.json(req,res,{some:"json",other:1});
});
