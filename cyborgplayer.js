master_network_address = "cyborgmaster.local"

raspberries = {
  1: {
    id:"r1",
    ip: "cyborgplayer1"
  },
  2: {
    id:"r2",
    ip: "cyborgplayer2"
  },
  3:{
    id:"r3",
    ip: "cyborgplayer3"
  },
}

var exec = require('child_process').exec;
var spawn = require('child_process').spawn;
var wget = require('wget-improved');
var logger = require('tracer').console();

speak = function(text, options, callback) {
  exec('espeak ' + (options? options : "-v german") + ' "' + text + '"',function(error, stdout, stderr) {
      //logger.log(stdout);
      logger.log("said " + text)
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

lastProgress = {}
downloading = false

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

logger.log("OK")

playButton.watch(function (err, value) {
  if (err) {
    throw err;
  }

  playButtonLastChanged = Date.now()

  if (value==0) {
    playButtonCount++
    logger.log("playbutton=" + playButtonCount)
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
    logger.log("stopbutton=" + stopButtonCount)
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
    logger.log("nextbutton=" + nextButtonCount)
    switch(state) {
      case "play":  changeState("stop"); break
      case "pause": changeState("stop");  break
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
  //logger.log(playPressedSecondsCounter)
  //logger.log(stopPressedSecondsCounter)
  //logger.log(nextPressedSecondsCounter)
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

  logger.log(oldstate + " -> " + newstate)


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
    logger.log("playing " + videosPrefix + videos[videoIndex])
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
    logger.log("next - new index ", getMappingIndex(), videoIndex)
    logger.log("vid " + videoIndex + ": " + videos[videoIndex])
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
    logger.log("vid " + videoIndex + ": " + videos[videoIndex])
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
    logger.log("vid " + videoIndex + ": " + videos[videoIndex])
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
      logger.log("remotevideo",remotevideo)
      if (videos[videoIndex] != remotevideo) {
        logger.log("transmitting new media " + videos[videoIndex])
        ddpclient.call(
          'setFilename',             // name of Meteor Method being called
          [{playerId : raspberries[raspberryNumber].id, filename: videos[videoIndex]}], // parameters to send to Meteor Method
          function (err, result) {   // callback which returns the method call results
            logger.log('called function, result: ' + result);
          },
          function () {              // callback which fires when server has finished
            logger.log('updated');  // sending any updated documents as a result of
            logger.log(ddpclient.collections.posts);  // calling this method
          }
        );
      }    
      var remotestate = ddpclient.collections.players[raspberries[raspberryNumber].id].state
      if (remotestate != newstate && newstate != "next" && newstate != "prev") {
        logger.log("transmitting new state " + newstate)
        ddpclient.call(
          'setState',             // name of Meteor Method being called
          [{playerId : raspberries[raspberryNumber].id, state: newstate}], // parameters to send to Meteor Method
          function (err, result) {   // callback which returns the method call results
            logger.log('called function, result: ' + result);
          },
          function () {              // callback which fires when server has finished
            logger.log('updated');  // sending any updated documents as a result of
            logger.log(ddpclient.collections.posts);  // calling this method
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
    logger.log(typeof blinker)
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
  logger.log("New mappings: ",videoIndexMapping)
  logger.log("New local playlist:")
  for (var i in videoIndexMapping) {
    logger.log("• (" + videoIndexMapping[i] + ") " + videos[videoIndexMapping[i]])
  }

}

downloadRemoteMedia = function() {

  if (!ddpclient)
    { logger.log ("download not possible - no ddp"); return }

  if (!ddpclient.collections )
    { logger.log ("download not possible - no ddp collections"); return }   

  if (!ddpclient.collections.players )
    { logger.log ("download not possible - no ddp players"); return }    


  if (!raspberries)
    { logger.log ("download not possible - no raspberries array"); return }    

  if (!raspberryNumber)
    { logger.log ("download not possible - no raspberry number"); return }    

  if (!raspberries[raspberryNumber])
    { logger.log ("download not possible - raspberry not in array"); return }    

  if (!ddpclient.collections.players[raspberries[raspberryNumber].id])
    { logger.log ("download not possible - no ddp player"); return }    

  if (!ddpclient.collections.players[raspberries[raspberryNumber].id].mediaStatus )
    { logger.log ("download not possible - no ddp mediaStatus"); return }    

  if (!ddpclient.collections.players[raspberries[raspberryNumber].id].mediaserver_address)
    { logger.log ("download not possible - no mediaserver address"); return }    

  if (!ddpclient.collections.players[raspberries[raspberryNumber].id].mediaserver_path )
    { logger.log ("download not possible - no mediaserver path"); return }    

  updateMediaFiles()
  var commands = []
  var player = ddpclient.collections.players[raspberries[raspberryNumber].id]

  for (var mediaId in player.mediaStatus) {

    (function(){

      var media = player.mediaStatus[mediaId]
      var mId = mediaId
      //logger.log(media)

      if (media.required && (videos.indexOf(key2filename(mediaId)) < 0) && ( typeof(downloading) == "undefined" || !downloading ) ) {

        downloading = true

        // downloading
        download_options = {
            protocol: 'http',
            host: player.mediaserver_address,
            path: '/' + player.mediaserver_path + key2filename(mediaId),
            method: 'GET',
            output: videosPrefix + key2filename(mediaId)
        };

        var src = download_options.protocol + "://" + download_options.host + download_options.path
        var output = download_options.output

        logger.log("downloading " + src + " to " + output)

        download = wget.download(src, output, download_options);

        download.on('error', function(err) {
            logger.log(err);
            downloading = false
            lastProgress[mId] = 0
            ddpclient.call('setPlayerMediaStatus', [{ 
              playerId : raspberries[raspberryNumber].id, 
              mediaId: mId, 
              attr: ['available', 'downloading'],
              value: [false, false],
            }], function(error, result){})              
        });
        download.on('start', function(fileSize) {
            logger.log("Starting download of " + mId + " filesize: " + fileSize);
            downloading = true
            lastProgress[mId] = -1
            ddpclient.call('setPlayerMediaStatus', [{ 
              playerId : raspberries[raspberryNumber].id, 
              mediaId: mId, 
              attr: ['available', 'progress', 'downloading'],
              value: [false, 0, true],
            }], function(error, result){})                   
        });
        download.on('end', function(output) {
          logger.log("downloaded " + mId)
          ddpclient.call('setPlayerMediaStatus', [{ 
            playerId : raspberries[raspberryNumber].id, 
            mediaId: mId, 
            attr: ['available', 'progress', 'downloading'],
            value: [true, 1, false],
          }], function(error, result){})          
          logger.log(output);
          downloading = false
          lastProgress[mId] = 1
          downloadRemoteMedia()
        });
        download.on('progress', function(progress) {
            if (typeof(lastProgress[mId]) == "undefined" || typeof(lastProgress[mId]) == "null") lastProgress[mId] = media.progress
            //logger.log("downloading " + mediaId, progress)
            //logger.log(media.progress, lastProgress[mediaId] - progress, Math.abs(lastProgress[mediaId] - progress), Math.abs(lastProgress[mediaId] - progress)>0.01)
            if ( lastProgress[mId] && Math.abs(lastProgress[mId] - progress) > 0.01 ) {
              ddpclient.call('setPlayerMediaStatus', [{ 
                playerId : raspberries[raspberryNumber].id, 
                mediaId: mId, 
                attr: ['progress','downloading'],
                value: [progress, true]
              }], function(error, result){})   
              lastProgress[mId] = progress
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

      else if ( (videos.indexOf(key2filename(mediaId)) > -1) && typeof(media.required)!="undefined" && media.required === false ) {

        var file = videosPrefix + key2filename(mId)

        if ( typeof(download) != "undefined" && downloading && download_options.output == file) {
          logger.log("cannot abort download of " + file)
          //download.end()
        }
        else {
          var command = "rm " + file
          logger.log(command)
          
          fs.unlink(file, function(){
            logger.log("removed " + file + " (" + mId + ")")
            ddpclient.call('setPlayerMediaStatus', [{ 
              playerId : raspberries[raspberryNumber].id, 
              mediaId: mId, 
              attr: ['progress', 'available'],
              value: [false, false]
            }], function(error, result){})             
            updateMediaFiles()
          })
        }
      } 
    })()
  }
}

function getFiles(srcpath) {
  return fs.readdirSync(srcpath).filter(function(file) {
    try {
      return fs.statSync(path.join(srcpath, file)).isFile();
    }
    catch(error) {
      logger.log("Error in stat with " +  file + " - " + error.code)
      return false
    }
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
     logger.log("updated media files");
     videos = newvideos
     videos.forEach(function (filename) { logger.log("• " + filename) })
     if (videoIndex > videos.length-1) {
      videoIndex = videos.length-1
     }
     updatePlaylist()
  }  
}

updateMediaFiles()

function updateMediaStatus() {

  var mediaStatus = ddpclient.collections.players[raspberries[raspberryNumber].id].mediaStatus
  var media = ddpclient.collections.media

  // go through local videos
  videos.forEach(function (filename) { 
    logger.log("set media status for " + filename)

    var this_available = true

    var filesize = fs.statSync( videosPrefix + filename )['size']

    if (mediaStatus && mediaStatus[filename2key(filename)] && mediaStatus[filename2key(filename)].expected_filesize) {
      var expected_filesize = mediaStatus[filename2key(filename)].expected_filesize
      logger.log("filesize for " + filename + " is " + filesize + ", expected was " + expected_filesize)
      if (filesize != expected_filesize) {
        logger.log( filename + " has wrong file size")
        fs.unlink(videosPrefix + filename, function(){
          logger.log("removed " + filename )
          updateMediaFiles()
        })        
        this_available = false
      }
    }

/*
    if (mediaStatus && mediaStatus[filename2key(filename)] && !mediaStatus[filename2key(filename)].required) {
      logger.log(filename + " is available but not required expected was ")
      fs.unlink(videosPrefix + filename, function(){
        logger.log("removed " + filename )
        updateMediaFiles()
      })        
      this_available = false
    }    */

    ddpclient.call('setPlayerMediaStatus', [{ 
      playerId : raspberries[raspberryNumber].id, 
      mediaId: filename2key(filename), 
      attr: 'available',
      value: this_available
    }], function(error, result){})
  })

  // go through videos in mediaStatus
  for (var m in mediaStatus) {
    var filename = key2filename(m)
    if (videos.indexOf(filename) < 0) {
      logger.log("set media status (not available) for " + filename) 
      ddpclient.call('setPlayerMediaStatus', [{ 
        playerId : raspberries[raspberryNumber].id, 
        mediaId: filename2key(filename), 
        attr: 'available',
        value: false
      }], function(error, result){})
    }

    if (!downloading && mediaStatus[m].downloading) {
      ddpclient.call('setPlayerMediaStatus', [{ 
        playerId : raspberries[raspberryNumber].id, 
        mediaId: filename2key(filename), 
        attr: 'downloading',
        value: false
      }], function(error, result){})      
    }
  }  

  
  // go through media collection
  if (media && mediaStatus) {
    for (var m in media){
      logger.log("checking " + m)
      if (mediaStatus[filename2key(m)] && mediaStatus[filename2key(m)].available === true && !mediaStatus[filename2key(m)].required) {
        logger.log("remove " + m)
        fs.unlink(videosPrefix + filename, function(){
          ddpclient.call('setPlayerMediaStatus', [{ 
            playerId : raspberries[raspberryNumber].id, 
            mediaId: filename2key(m), 
            attr: 'available',
            value: false
          }], function(error, result){})       
        })
      }
    }
  }
  


}

/*************** IP ****************/

raspberryNumber = 1

var os = require('os');
var ifaces = os.networkInterfaces();
var hostname = os.hostname()

var ip_assigned = false

// try hostname first
for (var r in raspberries) {
  if (raspberries[r].ip == hostname) {
    raspberryNumber = r
    ip_assigned = true
  }
}

// otherwise try assigned IPs
if (!ip_assigned) {
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
}

logger.log ("This is cyborgplayer number " + raspberryNumber)

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
    logger.log('DDP: connection error!');
    return;
  }

  if (wasReconnect) {
    logger.log('DDP: Reestablishment of a connection.');
    downloading = false // it's an assumption
  }

  ddpclient.subscribe(
    'players',                  // name of Meteor Publish function to subscribe to
    [{ noPingback : true, playerId: raspberries[raspberryNumber].id }],                       // any parameters used by the Publish function
    function () {             // callback when the subscription is complete
      logger.log('players complete:');
      if (ddpclient.collections.players){
        logger.log(ddpclient.collections.players[raspberries[raspberryNumber].id]);
        speak_system("connected")

        ddpclient.call('playerPingback', [raspberries[raspberryNumber].id], function (error, result) {});

        ddpclient.subscribe(
          'media',                  // name of Meteor Publish function to subscribe to
          [],                       // any parameters used by the Publish function
          function () {             // callback when the subscription is complete
            logger.log('media complete:', ddpclient.collections.media);
            updateMediaStatus()
            //logger.log(ddpclient.collections.mediaavail)

          }
        );  

        updateMediaStatus()
        downloadRemoteMedia()

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
      logger.log('mediaavail complete:');
      //logger.log(ddpclient.collections.mediaavail)
      if (ddpclient.collections.mediaavail) {
        updatePlaylist(ddpclient.collections.mediaavail)
      }

    }
  );  

  var media_observer = ddpclient.observe("media");
  media_observer.added = function(id) {
    logger.log("[ADDED] to " + media_observer.name + ":  " + id);
    ddpclient.call('setPlayerMediaStatus', [{ 
      playerId : raspberries[raspberryNumber].id, 
      mediaId: filename2key(id), 
      attr: ['expected_filesize'],
      value: [ddpclient.collections.media[id].filesize],
    }], function(error, result){})         
  }

  media_observer.ready = function() {
    logger.log("[READY] in " + media_observer.name);
  }

  var observer = ddpclient.observe("players");
  observer.added = function(id) {
    logger.log("[ADDED] to " + observer.name + ":  " + id);
  };
  observer.changed = function(id, oldFields, clearedFields, newFields) {
    if (id == raspberries[raspberryNumber].id) {
      
      /*
      logger.log("[CHANGED] in " + observer.name + ":  " + id);
      logger.log("[CHANGED] old field values: ", oldFields);
      logger.log("[CHANGED] cleared fields: ", clearedFields);
      logger.log("[CHANGED] new fields: ", newFields);   
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
        logger.log(newFields, oldFields)
        downloadRemoteMedia()
      }
    }
  };
  observer.removed = function(id, oldValue) {
    logger.log("[REMOVED] in " + observer.name + ":  " + id);
    logger.log("[REMOVED] previous value: ", oldValue);
  };


  var availobserver = ddpclient.observe("mediaavail");
  availobserver.added = function(id) {
    updatePlaylist()
    logger.log("[ADDED] to " + availobserver.name + ":  " + id);
    updatePlaylist()
    //speak_system("playlist updated")
  };
  availobserver.removed = function(id, oldValue) {
    logger.log("[REMOVED] in " + availobserver.name + ":  " + id);
    logger.log("[REMOVED] previous value: ", availobserver);
    updatePlaylist()
    //speak_system("playlist updated")
  };

})

function getMappingIndex() {
  logger.log("getMappingIndex " + videoIndex + " -> " + videoIndexMapping.indexOf(videoIndex))
  logger.log(videos, videoIndexMapping)  
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