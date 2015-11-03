var	http    = require('http'),
    spritz  = require('../spritz');

// Start
spritz.start({port:9999, processes:2});

spritz.on(/\/save$/,{method:"POST"},function(req,res){
    console.log("Test finnished successfully!");
});

(function(){
  var postData = '[{"DateTime": "Sat Feb 28 2015 11:00:00 GMT+0000 (WET)","Title": "Imagens dos Óscares revelam o lado mais terno das estrelas","Lead": "Para além do beijo de John Travolta a Scarlett Johansson que correu mundo e originou muitas piadas, existem outras imagens que captam os momentos mais humanos das estrelas nos Óscares.","Categories": ["Notícias","Lazer"],"ContentType": "news","isActive": true}]';
  var content = "";
  var req = http.request({
      hostname: '127.0.0.1',
      port: 9999,
      path: '/save',
      method: 'POST',
      headers: {
        'content-type' : 'application/json; charset=utf-8',
        'Content-Length': postData.length
      }
    }
    , function(res){

      res.setEncoding('utf8');
      res.on('data',function(d){ content += d.toString(); });
      res.on('end',function() {
        console.log('POST ended:', content);
      });

    });

  req.on('error', function(e){
    console.error("POST error:", e);
  });

  req.write(postData);
  req.end();
}());
