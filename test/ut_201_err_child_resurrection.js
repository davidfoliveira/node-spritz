var
    http    = require('http'),
    spritz  = require('../spritz');


// Perform a GET request
var doGet = function(uri,callback){

    var
        req,
		fired = false;
		_callback = function(err,res){
			if ( fired )
				return;
			fired = true;
			return callback(err,res);
		};

    console.log("Performing a GET "+uri);
    req = http.request(
        {
            hostname:   '127.0.0.1',
            port:       9999,
            path:       uri,
            method:     'GET',
            headers: {
                'content-type' :    'application/json; charset=utf-8'
            }
        },
        function(res){
            if ( res.statusCode != 200 )
                return _callback(new Error("Test fail to "+uri), res.statusCode);

            return _callback(null, res.statusCode);
        }
    );
    req.on('error', function(e){
        return _callback(e);
    });
    req.end();
	setTimeout(function(){
		return _callback(new Error("Request timed out"),null);
	},1000);
};

// Perform function calls in series
var series = function(fns,end) {

    var
        fn;

    if ( fns.length == 0 )
        return end(null);

    fn = fns.shift();
    return fn(function(err){
        if ( err ) 
            return end(err);
        return setImmediate(function(){
            series(fns,end);
        });
    });

}



// Start
spritz.start({port:9999, processes:2});

// A nice route
spritz.on(/^\/nice$/,function(req,res){
    return spritz.json(req,res,{ok:true});
});

// An explosion route
spritz.on(/^\/explode$/,function(req,res){
	process.exit(-1);
});


// Just for master
if ( require('cluster').isMaster ) {

	// Perform the tests
    setTimeout(function(){
        series(
            [
                function(next){
                    // Get /nice
                    doGet("/nice",function(err, res){
                        if ( err ) {
                            console.log("Error performing GET#1 request: ",err);
                            return process.exit(-1);
                        }
                        return next();
                    });
                },
                function(next){
                    // Get /explode
                    doGet("/explode",function(err, res){
                        if ( !err ) {
                            console.log("Error performing GET#2 request. The process was supposed to return and error and it didn't");
                            return process.exit(-1);
                        }
                        return next();
                    });                
                },
                function(next){
                    // Get /explode
                    doGet("/explode",function(err, res){
                        if ( !err ) {
                            console.log("Error performing GET#2 request. The process was supposed to return and error and it didn't");
                            return process.exit(-1);
                        }
                        return next();
                    });                
                },
                function(next){
                    // Get /nice
                    doGet("/nice",function(err, res){
                        if ( err ) {
                            console.log("Error performing GET#4 request. : ",err);
                            return process.exit(-1);
                        }
                        return next();
                    });
                },
            ],
            function(){
                console.log("OK");
                return process.exit(0);
            }
        );
    },1000);
}
