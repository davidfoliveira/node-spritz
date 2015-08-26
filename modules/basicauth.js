// Metadata
exports._meta = {
	type: "templating",
	name: "basicauth"
};

// On load
exports.init = function(){

	// Register the auth function
	this.auth = function(route,opts) {
		
	};

	// Waits for the definition of a route with 'auth'
	this.on('#SETROUTE',function(route){
		if ( !route.auth )
			return;
		if ( typeof route.auth == "function" ) {
			route.auth = { realm: 'Authentication required', check: route.auth };
			return;
		}
		if ( typeof route.auth == "object" && route.auth.username && route.auth.password ) {
			route.auth.check = function(u,p,cb){ return cb(null,u==route.auth.username && p==route.auth.password); };
			if ( !route.auth.realm )
				route.auth.realm = 'Authentication required';
			return;
		}
		route.auth = null;
	});

	// When a request arrives
	this.on('#FINDROUTE',function(req,res,args,cb){
		if ( !args || !args.route || !args.route.auth )
			return;

		// Parse the user Authorization header
		var
			self		= this,
			authUser	= '',
			authPass	= '';

		if ( req.headers && req.headers.authorization && req.headers.authorization.match(/^basic +(.+)/i) ) {
				var b64Auth = new Buffer(RegExp.$1,'base64');
				if ( b64Auth.toString().match(/^([^:]+):(.*)$/) ) {
					authUser = RegExp.$1;
					authPass = RegExp.$2;
				}
		}

		// Check
		return args.route.auth.check(authUser,authPass,function(err,ok){
			if ( err ) {
				self.json(req,res,{error:err},500);
				return cb(null,true,true);
			}

			// Authentication has failed
			if ( !ok ) {
				return self.json(req,res,{error:'Authentication failed'},401,{'www-authenticate':'Basic realm="'+args.route.auth.realm+'"'});
				return cb(null,true,true);
			}

			// Continue
			return cb();
		});

	});

};
