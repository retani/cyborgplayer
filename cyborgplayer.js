master_network_address = "192.168.0.2"

raspberries = {
  1: {
    id:"r1",
    ip: "192.168.0.10"
  },
  2: {
    id:"r2",
    ip: "192.168.0.11"
  },
  3:{
    id:"r3",
    ip: "192.168.0.12"
  },
}

var exec = require('child_process').exec;
var spawn = require('child_process').spawn;
var wget = require('wget-improved');

speak = function(text, options, callback) {
  exec('espeak ' + (options? options : "-v german") + ' "' + text + '"',function(error, stdout, stderr) {
      //console.log(stdout);
      console.log("said " + text)
      if (callback) callback(error, stdout, stderr)
  });  
}

speak_system = function(text, options, callback) {
  speak(text, (options? options : "-v default"), callback)
}

speak_system("o.k.")

var fs = require('fs')
var path = require('path');

var Gpio = require('onoff').Gpio,
  led = new Gpio(24, 'low'),
  playButton = new Gpio(18, 'in', 'both',{ debounceTimeout: 200 });
  stopButton = new Gpio(27, 'in', 'both',{ debounceTimeout: 200 });
  nextButton = new Gpio(23, 'in', 'both',{ debounceTimeout: 200 });

playButtonCount = 0
stopButtonCount = 0
nextButtonCount = 0

playButtonLastChanged = null
stopButtonLastChanged = null
nextButtonLastChanged = null

state="stop" // pause,play,stop
videos=[] // take from directory
videoIndex=0
videoIndexMapping=[]
backupVideoIndex=0

var videosPrefix="/home/pi/cyborg/media/"
//var videosPrefix="/Users/holger/Documents/Projekte/gluehland/cyborgplayer/cyborgmaster/public/media/"

function exit() {
  unload();
  process.exit();
}
 
function unload() {
  led.unexport();
  playButton.unexport();
  stopButton.unexport();
  nextButton.unexport();
  if (ddpclient.socket) ddpclient.close();  
}

console.log("OK")

playButton.watch(function (err, value) {
  if (err) {
    throw err;
  }

  playButtonLastChanged = Date.now()

  if (value==0) {
    playButtonCount++
    console.log("playbutton=" + playButtonCount)
    switch(state) {
      case "play":  changeState("pause"); break
      case "pause": changeState("play");  break
      case "stop":  changeState("play");  break
    }
  }
 
});
 
stopButton.watch(function (err, value) {
  if (err) {
    throw err;
  }

  stopButtonLastChanged = Date.now()
  
  if (value==0) {
    stopButtonCount++
    console.log("stopbutton=" + stopButtonCount)
    switch(state) {
      case "play":  changeState("stop"); break
      case "pause": changeState("stop");  break
      case "stop":  changeState("prev");  break
    }
  }    
 
});

nextButton.watch(function (err, value) {
  if (err) {
    throw err;
  }

  nextButtonLastChanged = Date.now()
  
  if (value==0) {
    nextButtonCount++
    console.log("nextbutton=" + nextButtonCount)
    switch(state) {
      case "play":  changeState("next"); break
      case "pause": changeState("next");  break
      case "stop":  changeState("next");  break
    }
  }    
 
});

process.on('SIGINT', exit);

var playPressedSecondsCounter = 0
var stopPressedSecondsCounter = 0
var nextPressedSecondsCounter = 0

triggerPoweroff = function() {
  //return ////////////////////////////////////// DISABLED
  var interval = 5 // seconds
  playButtonState = playButton.readSync()
  nextButtonState = nextButton.readSync()
  stopButtonState = stopButton.readSync()
  playPressedSecondsCounter = (playButtonState == 0 ? playPressedSecondsCounter+1 : 0)
  stopPressedSecondsCounter = (stopButtonState == 0 ? stopPressedSecondsCounter+1 : 0)
  nextPressedSecondsCounter = (nextButtonState == 0 ? nextPressedSecondsCounter+1 : 0)
  //console.log(playPressedSecondsCounter)
  //console.log(stopPressedSecondsCounter)
  //console.log(nextPressedSecondsCounter)
  if (stopPressedSecondsCounter >= interval) {
    clearInterval(poweroffInterval)
    omx.quit()
    unload()
    speak_system("good bye", null, function(){
      exec("sudo poweroff")
      //process.exit()
    })
  } 
  else if (nextPressedSecondsCounter > interval && playPressedSecondsCounter > interval) {
    clearInterval(poweroffInterval)
    omx.quit()
    unload()
    speak_system("restart", null, function(){
      exec("sudo reboot")
      //process.exit()
    })
  }
}

poweroffInterval = setInterval(triggerPoweroff, 1000)

function changeState(newstate, notransmit) {
  var oldstate = state

  if (oldstate == newstate) return

  console.log(oldstate + " -> " + newstate)


  LEDaction(newstate)

  if (oldstate == "play" && newstate == "pause") {
    //speak_system("pause")
    omx.pause()
  }

  if (oldstate == "pause" && newstate == "play") {
    speak_system("play")
    omx.pause()
  }

  if (oldstate == "stop" && newstate == "play") {
    speak_system("play")
    omx.start(videosPrefix + videos[videoIndex],function(){
      changeState("stop")
      if (state=="play") {
        speak_system("end")
      }
    })
    console.log("playing " + videosPrefix + videos[videoIndex])
  }

  if (oldstate == "play" && newstate == "stop") {
    speak_system("stop")
    omx.quit()
  }

  if (oldstate == "pause" && newstate == "stop") {
    speak_system("stop")
    omx.quit()
  }

  if (oldstate == "stop" && newstate == "next") {
    updateMediaFiles()
    var index = getMappingIndex()
    if (videoIndexMapping.length > index+1) {
      videoIndex = videoIndexMapping[index+1]
    }
    else {
      videoIndex=0  
    }
    console.log("next - new index ", getMappingIndex(), videoIndex)
    console.log("vid " + videoIndex + ": " + videos[videoIndex])
    announce_video()
    newstate = "stop"
    //return
  }

  if ((oldstate == "play" || oldstate == "pause") && newstate == "next") {
    omx.quit()
    updateMediaFiles()
    var index = getMappingIndex()
    if (videoIndexMapping.length > index+1) {
      videoIndex = videoIndexMapping[index+1]
    }
    else {
      videoIndex=0  
    }
    console.log("vid " + videoIndex + ": " + videos[videoIndex])
    announce_video()
    newstate = "stop"
    //return
  }

  if (oldstate == "stop" && newstate == "prev") {
    updateMediaFiles()
    var index = getMappingIndex()
    if (index > 0) {
      videoIndex = videoIndexMapping[index-1]
    }
    else {
      videoIndex=videoIndexMapping[videoIndexMapping.length-1]
    }
    if (videoIndex > videos.length-1) videoIndex = videos.length-1
    console.log("vid " + videoIndex + ": " + videos[videoIndex])
    announce_video()
    newstate = "stop"
    //return
  }

  if (oldstate = "next" && newstate == "stop") {
  }

  if (oldstate = "prev" && newstate == "stop") {
  }

  state = newstate

  if (!notransmit) {
    if (ddpclient && ddpclient.collections && ddpclient.collections.players) {
      var remotevideo = ddpclient.collections.players[raspberries[raspberryNumber].id].filename
      console.log("remotevideo",remotevideo)
      if (videos[videoIndex] != remotevideo) {
        console.log("transmitting new media " + videos[videoIndex])
        ddpclient.call(
          'setFilename',             // name of Meteor Method being called
          [{playerId : raspberries[raspberryNumber].id, filename: videos[videoIndex]}], // parameters to send to Meteor Method
          function (err, result) {   // callback which returns the method call results
            console.log('called function, result: ' + result);
          },
          function () {              // callback which fires when server has finished
            console.log('updated');  // sending any updated documents as a result of
            console.log(ddpclient.collections.posts);  // calling this method
          }
        );
      }    
      var remotestate = ddpclient.collections.players[raspberries[raspberryNumber].id].state
      if (remotestate != newstate && newstate != "next" && newstate != "prev") {
        console.log("transmitting new state " + newstate)
        ddpclient.call(
          'setState',             // name of Meteor Method being called
          [{playerId : raspberries[raspberryNumber].id, state: newstate}], // parameters to send to Meteor Method
          function (err, result) {   // callback which returns the method call results
            console.log('called function, result: ' + result);
          },
          function () {              // callback which fires when server has finished
            console.log('updated');  // sending any updated documents as a result of
            console.log(ddpclient.collections.posts);  // calling this method
          }
        );
      }
    }
  }

}

function LEDaction(newstate) {
  if (newstate == "pause") {
    blinkCounter = 0
    blinker = setInterval(blinkIt,400,20)
  }

  if (newstate == "play") {
    console.log(typeof blinker)
    if (typeof blinker !== "undefined") clearInterval(blinker)
    led.writeSync(0);
  }

  if (newstate == "stop") {
    if (typeof blinker !== "undefined") clearInterval(blinker)
    led.writeSync(1);
  }  

  if (newstate == "next") {
    blinkCounter = 0
    blinker = setInterval(blinkIt,50,1)
  }    

  if (newstate == "prev") {
    blinkCounter = 0
    blinker = setInterval(blinkIt,50,2)
  }      
}

blinkIt = function(max){
  if (max > 0 && max <= blinkCounter / 2 && typeof blinker !== "undefined") clearInterval(blinker)

  led.writeSync((blinkCounter % 2 == 0 ? 1 : 0))
  blinkCounter++
}

omx = require('omxcontrol');

/*
var express = require('express')
var app = express()
 
app.get('/', function (req, res) {
  res.send('Cyborgplayer')
})
 
app.listen(3005)

app.use(omx());
*/

updatePlaylist = function() {

  videoIndexMapping = Array.apply(null, Array(videos.length)).map(function (_, i) {return i;});
  return //////////////////////////////////////////////////////////////////////////////////// DISABLED


  if (!ddpclient || !ddpclient.collections || !ddpclient.collections.mediaavail || ddpclient.collections.mediaavail.length == 0) {
    videoIndexMapping = Array.apply(null, Array(videos.length)).map(function (_, i) {return i;});
  }
  else {
    videoIndexMapping = []
    for (var entry in ddpclient.collections.mediaavail) {
      if (ddpclient.collections.mediaavail[entry].playerId == raspberries[raspberryNumber].id) {
        if (videos.indexOf(ddpclient.collections.mediaavail[entry].mediaId) >= 0)
          videoIndexMapping.push(videos.indexOf(ddpclient.collections.mediaavail[entry].mediaId))
      }
    }
    if (videoIndex > videos.length-1){
      videoIndex = videos.length-1
    }
  }
  /*videoIndexMapping = videoIndexMapping.sort(function(a, b) {
    return a - b;
  })*/
  console.log("New mappings: ",videoIndexMapping)
  console.log("New local playlist:")
  for (var i in videoIndexMapping) {
    console.log("• (" + videoIndexMapping[i] + ") " + videos[videoIndexMapping[i]])
  }

}

downloadRemoteMedia = function() {

  if (!ddpclient)
    { console.log ("download not possible - no ddp"); return }

  if (!ddpclient.collections )
    { console.log ("download not possible - no ddp collections"); return }   

  if (!ddpclient.collections.players )
    { console.log ("download not possible - no ddp players"); return }    


  if (!raspberries)
    { console.log ("download not possible - no raspberries array"); return }    

  if (!raspberryNumber)
    { console.log ("download not possible - no raspberry number"); return }    

  if (!raspberries[raspberryNumber])
    { console.log ("download not possible - raspberry not in array"); return }    

  if (!ddpclient.collections.players[raspberries[raspberryNumber].id])
    { console.log ("download not possible - no ddp player"); return }    

  if (!ddpclient.collections.players[raspberries[raspberryNumber].id].mediaStatus )
    { console.log ("download not possible - no ddp mediaStatus"); return }    

  if (!ddpclient.collections.players[raspberries[raspberryNumber].id].mediaserver_address)
    { console.log ("download not possible - no mediaserver address"); return }    

  if (!ddpclient.collections.players[raspberries[raspberryNumber].id].mediaserver_path )
    { console.log ("download not possible - no mediaserver path"); return }    

  updateMediaFiles()
  var commands = []
  var player = ddpclient.collections.players[raspberries[raspberryNumber].id]
  for (var mediaId in player.mediaStatus) {
    var media = player.mediaStatus[mediaId]
    if (media.required && !media.available) {

      // downloading
      var options = {
          protocol: 'http',
          host: player.mediaserver_address,
          path: '/' + player.mediaserver_path + key2filename(mediaId),
          method: 'GET'
      };

      var src = options.protocol + "://" + options.host + options.path
      var output = videosPrefix + key2filename(mediaId)

      console.log("downloading " + src + " to " + output)

      var download = wget.download(src, output, options);
      download.on('error', function(err) {
          console.log(err);
      });
      download.on('start', function(fileSize) {
          console.log("Starting download of " + mediaId + " filesize: " + fileSize);
      });
      download.on('end', function(output) {
        console.log("downloaded " + mediaId)
        ddpclient.call('setPlayerMediaStatus', [{ 
          playerId : raspberries[raspberryNumber].id, 
          mediaId: mediaId, 
          attr: 'available',
          value: true
        }], function(error, result){})                
        console.log(output);
      });
      download.on('progress', function(progress) {
          console.log("downloading " + mediaId, progress)
          if (typeof(media.progress) != "number" || Math.abs(media.progress - progress) > 0.01) {
            ddpclient.call('setPlayerMediaStatus', [{ 
              playerId : raspberries[raspberryNumber].id, 
              mediaId: mediaId, 
              attr: 'progress',
              value: progress
            }], function(error, result){})   
          }
      });      

    }

    /*
    if (ddpclient.collections.mediaavail[entry].playerId == raspberries[raspberryNumber].id) {
      if (videos.indexOf(ddpclient.collections.mediaavail[entry].mediaId) < 0) {
        var command = commands.push("wget -P " + videosPrefix + player.mediaserver_address + "/" + player.mediaserver_path + ddpclient.collections.mediaavail[entry].mediaId)
      }
    }
    */

    else if (media.available && !media.required) {
      var filename = videosPrefix + key2filename(mediaId)
      var command = "rm " + filename
      console.log(command)

      /*
        var terminal = spawn(command)

        terminal.stdout.on('data', function (data) {
            console.log('stdout: ' + data);
        });

        terminal.stderr.on('data', function (data) {
            console.log('stderr: ' + data);
        });      
        terminal.on('exit', function (code) {
            console.log(command + ' exited with code ' + code);
        });      
      */
    }

    /*
    var command = commands.join(" && ")
    var terminal = spawn(command)

    terminal.stdout.on('data', function (data) {
        console.log('stdout: ' + data);
    });

    terminal.stderr.on('data', function (data) {
        console.log('stderr: ' + data);
    });

    terminal.on('exit', function (code) {
        console.log('child process exited with code ' + code);
    });
    */
  }
}

function getFiles(srcpath) {
  return fs.readdirSync(srcpath).filter(function(file) {
    return fs.statSync(path.join(srcpath, file)).isFile();
  });
}

function getMediaFiles() {
  out = []
  getFiles(videosPrefix).forEach(function (filename) {
    if (filename.substr(0,1) != ".")
    out.push(filename)
  });
  return out
}

function updateMediaFiles() {
  newvideos = getMediaFiles().sort()
  if (videos.length == newvideos.length
      && videos.every(function(u, i) {
          return u === newvideos[i];
      })
  ) {
     // nothing changed
  } else {
     console.log("updated media files");
     videos = newvideos
     videos.forEach(function (filename) { console.log("• " + filename) })
     if (videoIndex > videos.length-1) {
      videoIndex = videos.length-1
     }
     updatePlaylist()
  }  
}

updateMediaFiles()

/*************** IP ****************/

raspberryNumber = 1

var os = require('os');
var ifaces = os.networkInterfaces();

if (ifaces.wlan0) {
  ifaces.wlan0.forEach(function (iface) {
    if ('IPv4' !== iface.family || iface.internal !== false) {
      // skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
      return;
    }

    for (var r in raspberries) {
      if (raspberries[r].ip == iface.address) {
        raspberryNumber = r
      }
    }

  })
}

console.log ("This is cyborgplayer number " + raspberryNumber)

/*************** DDP ***************/

var DDPClient = require("ddp");

var ddpclient = new DDPClient({
  // All properties optional, defaults shown
  host : master_network_address,
  port : 3000,
  ssl  : false,
  autoReconnect : true,
  autoReconnectTimer : 500,
  maintainCollections : true,
  ddpVersion : '1',  // ['1', 'pre2', 'pre1'] available
  // uses the SockJs protocol to create the connection
  // this still uses websockets, but allows to get the benefits
  // from projects like meteorhacks:cluster
  // (for load balancing and service discovery)
  // do not use `path` option when you are using useSockJs
  useSockJs: true,
  // Use a full url instead of a set of `host`, `port` and `ssl`
  // do not set `useSockJs` option if `url` is used
  url: 'wss://'+master_network_address+'/websocket'
});

ddpclient.connect(function(error, wasReconnect) {
  // If autoReconnect is true, this callback will be invoked each time
  // a server connection is re-established
  if (error) {
    console.log('DDP connection error!');
    return;
  }

  if (wasReconnect) {
    console.log('Reestablishment of a connection.');
  }

  ddpclient.subscribe(
    'players',                  // name of Meteor Publish function to subscribe to
    [],                       // any parameters used by the Publish function
    function () {             // callback when the subscription is complete
      console.log('players complete:');
      if (ddpclient.collections.players){
        console.log(ddpclient.collections.players[raspberries[raspberryNumber].id]);
        speak_system("connected")
      }
      else {
        speak_system("connection problem")
      }
    }
  );  

  ddpclient.subscribe(
    'mediaavail',                  // name of Meteor Publish function to subscribe to
    [],                       // any parameters used by the Publish function
    function () {             // callback when the subscription is complete
      console.log('mediaavail complete:');
      //console.log(ddpclient.collections.mediaavail)
      if (ddpclient.collections.mediaavail) {
        updatePlaylist(ddpclient.collections.mediaavail)
      }

    }
  );  

  videos.forEach(function (filename) { 
    console.log("set media status for " + filename) 
    ddpclient.call('setPlayerMediaStatus', [{ 
      playerId : raspberries[raspberryNumber].id, 
      mediaId: filename, 
      attr: 'available',
      value: true
    }], function(error, result){})
  })


  var observer = ddpclient.observe("players");
  observer.added = function(id) {
    console.log("[ADDED] to " + observer.name + ":  " + id);
  };
  observer.changed = function(id, oldFields, clearedFields, newFields) {
    if (id == raspberries[raspberryNumber].id) {
      /*
      console.log("[CHANGED] in " + observer.name + ":  " + id);
      console.log("[CHANGED] old field values: ", oldFields);
      console.log("[CHANGED] cleared fields: ", clearedFields);
      console.log("[CHANGED] new fields: ", newFields);   
      */   
      if (newFields.filename) {
        backupVideoIndex = videoIndex
        /*
        if (!newFields.state || newFields == "stop"){ // remote preload
          if (newFields.filename != videos[videoIndex]) {
            speak_system("remote preload")
            var newIndex = videos.indexOf("newFields.filename")
            if (newIndex == -1) newIndex = 0
            videoIndex = newIndex
            omx.play(videos[videoIndex])
            state="play"
            changeState("pause")
          }
          else {
            if (state == "play") {
              changeState("pause")
              omx.sendKey("i")
            }
            else if (state == "pause") {
              omx.sendKey("i")
            }
            else if (state == "stop") {
              omx.play(videos[videoIndex])
              state="play"
              changeState("pause")
            }
          }
        }
        else {
          if (videos.indexOf(newFields.filename) < 0) videoIndex = 0
          else videoIndex = videos.indexOf(newFields.filename)          
        }
        */
        if (newFields.filename != videos[videoIndex]) {

          if (videos.indexOf(newFields.filename) < 0) videoIndex = 0
          else videoIndex = videos.indexOf(newFields.filename)            
          announce_video()      
        }
      }
      if (newFields.state) {
        if (newFields.state == "play") {
          changeState("play")
        }
        if (newFields.state == "stop") {
          changeState("stop")
        }
        if (newFields.state == "pause") {
          changeState("pause")
        }        
      }
      if (newFields.volume) {
        if (newFields.volume == 1) {
          for (var i=0; i<=10; i++){
            omx.sendKey("+")
          }
        }
        if (newFields.volume == 0) {
          for (var i=0; i<=10; i++){
            omx.sendKey("-")
          }
        }
      }
      if (newFields.pingtime) {
        ddpclient.call('playerPingback', [raspberries[raspberryNumber].id], function (error, result) {});
      }      
      if (newFields.mediaStatus) {
        downloadRemoteMedia()
      }
    }
  };
  observer.removed = function(id, oldValue) {
    console.log("[REMOVED] in " + observer.name + ":  " + id);
    console.log("[REMOVED] previous value: ", oldValue);
  };


  var availobserver = ddpclient.observe("mediaavail");
  availobserver.added = function(id) {
    updatePlaylist()
    console.log("[ADDED] to " + availobserver.name + ":  " + id);
    updatePlaylist()
    //speak_system("playlist updated")
  };
  availobserver.removed = function(id, oldValue) {
    console.log("[REMOVED] in " + availobserver.name + ":  " + id);
    console.log("[REMOVED] previous value: ", availobserver);
    updatePlaylist()
    //speak_system("playlist updated")
  };

})

function getMappingIndex() {
  console.log("getMappingIndex " + videoIndex + " -> " + videoIndexMapping.indexOf(videoIndex))
  console.log(videos, videoIndexMapping)  
  if (videoIndexMapping.indexOf(videoIndex) >= 0)
    return videoIndexMapping.indexOf(videoIndex)
  else if (videoIndexMapping.indexOf(backupVideoIndex) >= 0)
    return videoIndexMapping.indexOf(backupVideoIndex)
  else return 0
}

function announce_video() {
  //speak(videos[videoIndex].split(".")[0].split(" ")[0])
  speak(videos[videoIndex].substr(0,videos[videoIndex].length-4))
}


filename2key = function(filename) {
  return filename.replace(/\./g, "*")
}

key2filename = function(key) {
  return key.replace(/\*/g, ".")
}