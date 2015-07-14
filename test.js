var
	fs = require('fs'),
	spritz = require('./spritz'),
	https;

spritz.start({
	port: 8081
});
spritz.on('/',function(req,res){
	return spritz.text(req,res,'/ 8081');
});

https = spritz.newServer();
https.start({
	proto:	"https",
	key:	fs.readFileSync('/Users/david/Documents/Personal/Accounts/prozone.org/prozone_org.key'),
	cert:	fs.readFileSync('/Users/david/Documents/Personal/Accounts/prozone.org/prozone_org.crt')
});
https.on('/',function(req,res){
	return spritz.text(req,res,'/ 443');
});
