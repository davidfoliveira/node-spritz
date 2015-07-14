// On load
exports.load = function(){

	// Register the auth function
	this.auth = function(route,opts) {
	};

	// When a request arrives
	this.on('request_arrive',function(req,res){
		console.log("REQUEST ARRIVED: "+req.url);
/*		var
			authUser = '',
			authPass = '';

		if ( req.headers && req.headers.authorization && req.headers.authorization.match(/^basic +(.+)/i) ) {
				var b64Auth = new Buffer(RegExp.$1,'base64');
				if ( b64Auth.toString().match(/^([^:]+):(.*)$/) ) {
					authUser = RegExp.$1;
					authPass = RegExp.$2;
				}
		}
*/
	});

};
