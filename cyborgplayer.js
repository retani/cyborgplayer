var fs = require('fs')
var path = require('path');

var Gpio = require('onoff').Gpio,
  led = new Gpio(24, 'low'),
  playButton = new Gpio(18, 'in', 'both',{ debounceTimeout: 200 });
  stopButton = new Gpio(27, 'in', 'both',{ debounceTimeout: 200 });

playButtonCount = 0
stopButtonCount = 0

state="stop" // pause,play,stop
videos=[] // take from directory
videoIndex=0

var videosPrefix="/home/pi/cyborg/media/"
 
function exit() {
  led.unexport();
  playButton.unexport();
  stopButton.unexport();
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
      case "stop":  changeState("next");  break
    }
  }    
 
});

process.on('SIGINT', exit);

function changeState(newstate) {
  var oldstate = state

  if (oldstate == newstate) return

  console.log(oldstate + " -> " + newstate)

  LEDaction(newstate)

  if (oldstate == "play" && newstate == "pause") {
    omx.pause()
  }

  if (oldstate == "pause" && newstate == "play") {
    omx.pause()
  }

  if (oldstate == "stop" && newstate == "play") {
    omx.start(videosPrefix + videos[videoIndex])
    console.log("playing " + videosPrefix + videos[videoIndex])
  }

  if (oldstate == "play" && newstate == "stop") {
    omx.quit()
  }

  if (oldstate == "pause" && newstate == "stop") {
    omx.quit()
  }

  if (oldstate == "stop" && newstate == "next") {
    updateMediaFiles()
    videoIndex++
    if (videoIndex >= videos.length) videoIndex = 0
    console.log("vid: " + videos[videoIndex])
    changeState("stop")
    return
  }

  if (oldstate = "next" && newstate == "stop") {

  }

  state = newstate
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
    blinker = setInterval(blinkIt,50,2)
  }    
}

blinkIt = function(max){
  if (max > 0 && max <= blinkCounter / 2 && typeof blinker !== "undefined") clearInterval(blinker)

  led.writeSync((blinkCounter % 2 == 0 ? 1 : 0))
  blinkCounter++
}

omx = require('omxcontrol');


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
  newvideos = getMediaFiles()
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
  }  
}

updateMediaFiles()
