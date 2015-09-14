master_network_address = "192.168.0.100"

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

state="stop" // pause,play,stop
videos=[] // take from directory
videoIndex=0
videoIndexMapping=[]
backupVideoIndex=0

var videosPrefix="/home/pi/cyborg/media/"
//var videosPrefix="/Users/holger/Documents/Projekte/gluehland/cyborgplayer/cyborgmaster/public/media/"

function exit() {
  led.unexport();
  playButton.unexport();
  stopButton.unexport();
  nextButton.unexport();
  ddpclient.close();
  process.exit();
}
 
console.log("OK")

playButton.watch(function (err, value) {
  if (err) {
    throw err;
  }

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


  var observer = ddpclient.observe("players");
  observer.added = function(id) {
    console.log("[ADDED] to " + observer.name + ":  " + id);
  };
  observer.changed = function(id, oldFields, clearedFields, newFields) {
    console.log("[CHANGED] in " + observer.name + ":  " + id);
    console.log("[CHANGED] old field values: ", oldFields);
    console.log("[CHANGED] cleared fields: ", clearedFields);
    console.log("[CHANGED] new fields: ", newFields);
    if (id == raspberries[raspberryNumber].id) {
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
