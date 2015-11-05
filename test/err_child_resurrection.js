var async   = require('async'),
    http    = require('http'),
    spritz  = require('../spritz');

// Start
spritz.start({port:9999, processes:2});

spritz.on(/\/(\d{1,2})$/,function(req,res){
    var n = parseInt(RegExp.$1);
    if( n < 1 )
        throw "CABUM!!";
    return spritz.json(req,res,{ok:n});
});

if ( require('cluster').isMaster ) {
    var turn = true;
    var doGet = function(x,callback){
        console.log("GET",x,"time.");
        var content = "";
        var req     = http.request(
            {
                hostname:   '127.0.0.1',
                port:       9999,
                path:       '/'+x,
                method:     'GET',
                headers: {
                    'content-type' :    'application/json; charset=utf-8'
                }
            },
            function(res){
                res.setEncoding('utf8');
                res.on('data',function(d){ content += d.toString(); });
                res.on('end',function() {
                    if ( res.statusCode != 200 ) {
                        console.log("Expected status 200 and got: ",res.statusCode);
                        return callback(new Error("Test fail to",x), res.statusCode);
                    }
                    console.log("Test finished successfully to", x);
                    return callback(null, res.statusCode);
                });
            }
        );
        req.on('error', function(e){
            console.error("GET error:", e);
            return callback(e);
            //return process.exit(-1);
        });
        req.end();
    };

    var schedule = function(){
        var _n = turn ? 1 : 0;
        doGet(_n,function(err, res){
            turn = !turn;
            schedule(_n);
        });
    }

    setTimeout(function(){
        schedule();
    },1000);
}
