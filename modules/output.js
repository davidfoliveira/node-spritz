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
            ext = "unknown",
            hasRange = false,
            streamOpts = {};

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

            // Is this a range request?
            if (req.headers.range && req.headers.range.toString().match(/bytes=(\d+)-(\d+)?/)) {
                hasRange = true;
                streamOpts = {
                    start: parseInt(RegExp.$1) || 0,
                    end:   RegExp.$2 != '' ? parseInt(RegExp.$2) : stat.size-1
                };
            }

            var
                expires = new Date(),
                _headers = self._merge({
                    'content-type':     (self._opts.mimes[ext] || 'text/plain'),
                    'content-length':   stat.size,
                    'date':             new Date().toUTCString()
                },headers,true);

            // Range headers
            if (hasRange) {
                _headers['content-length'] = streamOpts.end - streamOpts.start + 1;
                _headers['content-range'] = 'bytes '+streamOpts.start+'-'+parseInt(streamOpts.end)+'/'+stat.size;
                status = 206;
            }

            // Send the http response head
            return self._writeHead(self,req,res,status || 200,_headers,function(){
                const stream = fs.createReadStream(filename, streamOpts);

                // Send file
                return self._pipeStream(self,req,res,stream,function(){

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
