var
	fs = require('fs'),
	spritz = require('../spritz'),
	https;

spritz.start({
	port: 8081
});
spritz.on('/',function(req,res){
	return spritz.text(req,res,'/ 8081');
});

https = spritz.newServer();
https.start({
//	proto:	"https",
	key:	fs.readFileSync('/Users/david/Documents/Personal/Accounts/prozone.org/prozone_org.key'),
	cert:	fs.readFileSync('/Users/david/Documents/Personal/Accounts/prozone.org/prozone_org.crt'),
    port:	8082
});
https.on('#arrive',function(req,res,args,cb){
	console.log("REQ ARRIVED: "+req.url);
	return cb();
});
https.on('#readheaders',function(req,res,args,cb){
	console.log("READ HEADERS: "+req.url);
	return cb();
});
https.on('#read',function(req,res,args,cb){
	console.log("READ "+req.url);
	return cb();
});
https.on('#findroute',function(req,res,args,cb){
	console.log("FINDROUTE "+req.url,args);
	return cb();
});
https.on('#beforewritehead',function(req,res,args,cb){
	console.log("WILL WRITE HEAD: "+req.url);
	return cb();
});
https.on('#beforewritedata',function(req,res,args,cb){
	console.log("WILL WRITE DATA: "+req.url);
	return cb();
});
https.on('#beforefinish',function(req,res,args,cb){
	console.log("WILL FINISH: "+req.url);
	return cb();
});
https.on('#finish',function(req,res,args,cb){
	console.log("FINISH: "+req.url);
	return cb();
});
https.on('/',function(req,res){
	return spritz.text(req,res,'/ 443');
});
//https.on('/template',{auth:function(u,p,cb){return cb(null,u=="capo" && p=="dei capi");}},function(req,res){

https.use(require('spritz-jstemplate'),{viewDir:__dirname+'/views'});
https.on('/template',{auth:{username:"zapo",password:"dei capi"}},function(req,res){
	return https.template(req,res,'test.jst',{sir:process.env.LOGNAME});
});
https.on(404,function(req,res){
	return https.text(req,res,'404 FAIL',404);
});
