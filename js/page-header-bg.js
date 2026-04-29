(function () {
  var images = [
    'img/snowbasin-images/tail-lights.jpeg',
    'img/snowbasin-images/summer.jpeg',
    'img/snowbasin-images/incoming-storm.jpeg',
    'img/snowbasin-images/sunset-2.jpeg',
    'img/snowbasin-images/sunset.jpeg',
    'img/snowbasin-images/night-grooming.jpeg',
    'img/snowbasin-images/haze.jpeg',
    'img/snowbasin-images/tron.jpeg'
  ];
  var pick = images[Math.floor(Math.random() * images.length)];
  document.documentElement.style.setProperty('--page-header-bg', 'url("' + pick + '")');
})();
