var
    http    = require('http'),
    https   = require('https');


// Metadata
exports._meta = {
    core: true,
    type: "proxy",
    name: "proxy"
};


// On load
exports.init = function(){

    var
        self = this;

    // Proxy the request
    self.proxy = function(req, res, hostOrURL, port, opts, callback){

        var
            args = Array.prototype.slice.call(arguments, 0),
            url,
            timeout,
            fired = false,
            docSize = 0,
            _opts = {};

        // Get the arguments
        req         = args.shift();
        res         = args.shift();
        hostOrURL   = args.shift();
        opts        = args.pop() || {};
        port        = args.shift() || 80;

        // What url ?
        url = (req.url === req.urlNoArgs) ? req.originalURL : req.url;

        // Options with defaults
        _opts = self._merge({
            proto:   "http",
            host:    hostOrURL,
            port:    port,
            path:    url,
            headers: req.headers || {}
        }, opts||{}, true);

        // Trying to proxy a POST request with already read POST data ?
        if ( req.method == "POST" && req._readPOSTData ) {
            var err = new Error("Trying to proxy a POST request with POST data already read. Please supply dontReadPOSTData:true on route options.");
            if ( _opts.onError )
                return _opts.onError(err);
            else
                throw err;
        }

        // Validate and load host/url
        if ( !hostOrURL )
            throw new Error("No host/url to send the request");
        // Host:port
        else if ( hostOrURL.match(/:(\d+)$/) ) {
            _opts.port = parseInt(RegExp.$1);
            _opts.host = hostOrURL.replace(/:.*$/, " ");
            _opts.headers.host = _opts.host;
        }
        // URL
        else if ( hostOrURL.match(/^https?:\/\//) ) {
            var u = require('url').parse(hostOrURL);
            _opts.proto = u.protocol.replace(/:.*$/, "");
            _opts.host = u.hostname;
            _opts.headers.host = u.hostname;
            _opts.port = u.port;
            _opts.path = u.path;
        }

        // No port ? defaults to the default protocol port
        if ( !_opts.port )
            _opts.port = (_opts.proto == "https" ? 443 : 80);

        // If we have an output filter, make sure we delete the 'accept-encoding' header to not get encoded data
        if (opts.outputFilter)
            delete req.headers['accept-encoding'];

        var
            proto = (_opts.proto == "https") ? https : http,
            preq = proto.request({
                host:    _opts.host,
                port:    _opts.port,
                method:  req.method,
                headers: _opts.headers || req.headers,
                path:    _opts.path
            });

        // Timeout event
        if ( _opts.timeout ) {
            timeout = setTimeout(function(){
                preq.abort();
                fired = true;
                if ( _opts.onTimeout )
                    return _opts.onTimeout();
                return self._writeHead(self, req, res, 502, {'Content-type':'text/plain; charset=UTF-8'}, function(){
                    return self._writeData(self, req, res, '502 - Gateway timeout :-(', true, function(){});
                });
            }, _opts.timeout);
        }

        // On response arrive
        preq.on('response', function(pres){
            if ( fired )
                return;
            if ( timeout )
                clearTimeout(timeout);

            if ( typeof opts.outputFilter == "function" ) {
                var allData = null;
                pres.on('data', function(data){
                    var newB = new Buffer(((allData != null) ? allData.length : 0)+data.length);
                    if ( allData != null )
                        allData.copy(newB, 0, 0, allData.length);
                    data.copy(newB, ((allData != null) ? allData.length : 0), 0, data.length);
                    allData = newB;
                });
                pres.on('end', function(){
                    var d = opts.outputFilter(allData, req, res, preq, pres);
                    if ( d == null )
                        d = allData;

                    pres.headers['content-length'] = d.length;
                    return self._writeHead(self, req, res, res.statusCode, pres.headers, function(){
                        return self._writeData(self, req, res, d, true, function(){
                            // Run the callback
                            if ( callback )
                                callback(null, true);

                            // Log
                            return self._access_log(req, res, pres.headers['content-length']||'??');
                        });
                    });
                });
            }
            else {
                return self._writeHead(self, req, res, pres.statusCode, pres.headers, function(){
                    var pr = pres.pipe(res);
                    pr.on('end', function(){
                        // Run the callback
                        if ( callback )
                            callback(null, true);

                        // Log
                        self._access_log(req, res, pres.headers['content-length']||'??');
                    });
                });
            }
        });
        preq.on('error', function(e){
            if ( _opts.onError )
                return _opts.onError(e);
            return self._writeHead(self, req, res, 503, {'content-type':'text/plain; charset=UTF-8'}, function(){
                return self._writeData(self, req, res, '503 - Gateway error: '+e.toString(), true, function(){
                    preq.abort();
                    return self._access_log(req, res, 19);
                });
            });
        });
        if ( req.headers && req.headers['content-length'] )
            req.pipe(preq);
        else
            preq.end();

    };

};
