var
    fs = require('fs');


// Metadata
exports._meta = {
	core: true,
	type: "output",
	name: "output"
};


// On load
exports.init = function(){

    var
        self = this;

    // Send a static file
    self.staticfile = function(req,res,filename,status,headers,callback) {

        var
            ext = "unknown";

        // Remove unsafe stuff
        filename = filename.replace(/\.\./,"").replace(/\/+/,"/");
        // He's asking for a directory? We don't serve directories..
        if ( filename.match(/\/$/) )
            filename += "index.html";
        // Get the extension for sending the propper mime type
        if ( filename.match(/\.(\w+)$/) )
            ext = RegExp.$1;

    //  self._log_info("Serving static file "+filename);
        return fs.stat(filename, function(err, stat) {
            if ( err ) {
                if ( err.code == "ENOENT" ) {
                    res.statusCode = 404;
                    if ( callback )
                        callback(err,null);
                    return self._routeStatus(req,res,false);
                }

                // Send the error
                return self.json(req,res,{error:err},500,{},function(_err){
                    // Error sending error, great!
                    if ( _err ) {
    //                  self._log_error("Error sending error: ",err);
                        return callback ? callback(_err,null) : null;
                    }
                    return callback ? callback(err,null) : null;
                });
            }

            var
                expires = new Date(),
                _headers = self._merge({
                    'content-type':     (self._opts.mimes[ext] || 'text/plain'),
                    'content-length':   stat.size,
                    'date':             new Date().toUTCString()
                },headers,true);

            // Send the http response head
            return self._writeHead(self,req,res,status || 200,_headers,function(){

                // Send file
                return self._pipeStream(self,req,res,fs.createReadStream(filename),function(){

                    // Write and end
                    return self._fireHook(self,'beforefinish',[req,res,{}],function(){
                        res.end();

                        // Finish
                        return self._fireHook(self,'finish',[req,res,{}],function(){

                            // Report status
                            self._routeStatus(req,res,true);

                            // Log
                            self._access_log(req,res,stat.size);

                            return callback ? callback() : null;
                        });
                    });

                });
            });
        });

    };
    self.file = self.staticfile;

};
