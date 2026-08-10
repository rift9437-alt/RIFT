/* =========================================================
   PLAYER-MADE SPRITES (tanks + cars)
   ========================================================= */
const SPRITES = {};
function loadSprite(key, b64){
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  SPRITES[key] = img;
}
loadSprite('redTank', 'iVBORw0KGgoAAAANSUhEUgAAAAwAAAAJCAYAAAAGuM1UAAAAg0lEQVR4nGNgQAJKN67+V7px9T8DHsCErBgbGx2wbBIT+8/AwMBQgCYBE79bVc/AwMDAcOrUKQYzMzMGFpiCCXaO+FwCB4wwk3ABv1evGJH5TLgU4rSBgYGBoX/CVAxbTp06xbB82UJGdHGW/glT/x87egDDJCtrBwYGBob/6JpItgEAbU0v/IXch8kAAAAASUVORK5CYII=');
loadSprite('blueTank', 'iVBORw0KGgoAAAANSUhEUgAAAAwAAAAJCAYAAAAGuM1UAAAAg0lEQVR4nGNgQAJKN67+V7px9T8DHsCErBgbGx2waPuf/c/AwMDwHU0CJp7ieIKBgYGB4dSpUwxmZmYMLDAFnOU/8LkEDhhhJuECVzcaMyLzmXApxGkDAwMDQ/+EqRi2nDp1imH5soWM6OIs/ROm/j929ACGSVbWDgwMDAz/0TWRbAMAKdIxVeC0PcgAAAAASUVORK5CYII=');
loadSprite('redCar', 'iVBORw0KGgoAAAANSUhEUgAAAAYAAAAHCAYAAAArkDztAAAAOElEQVR4nGNkYGD4f01engEZaD18yMAE4/js3Mbgs3MbXJIJXTUDAwPDNXl5hA50gFOCkaDl6AAA8RYNqXhYPe8AAAAASUVORK5CYII=');
loadSprite('blueCar', 'iVBORw0KGgoAAAANSUhEUgAAAAYAAAAHCAYAAAArkDztAAAAOElEQVR4nGNkYGD4r+1/lgEZXN1ozMAE43zv5GD43skBl2RCV83AwMCg7X8WoQMd4JRgJGg5OgAA7YANqfUeofAAAAAASUVORK5CYII=');
loadSprite('redPlayer', 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAAHCAYAAADNufepAAAAPUlEQVR4nEXHoQHAIBAEwQWJu1poIe3RES1QR/wL7MXwYdVs8TvMqezZ/6mJ9qw7e3YAHJIBkwjJFSAkAD6GUBOpYg8FVwAAAABJRU5ErkJggg==');
loadSprite('bluePlayer', 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAHCAYAAAAvZezQAAAARElEQVR4nGP8/7z3PwMSYPy2xxguwOVylpEJicPAwMDAABf4tscYwggICPjf++f//4CAAIhWGKf3z///cC22a9bDbQEAIkQcddA8YGoAAAAASUVORK5CYII=');
loadSprite('hopperPlayer', 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAAHCAYAAADNufepAAAAPUlEQVR4nGP8/7z3PwMUMH7bYwznMMEYXC5nEZxve4wZGBgYGP4fDHj5n4GB4T9choGBgYERKsrAwMDAAABWiBFQ22M+hgAAAABJRU5ErkJggg==');
loadSprite('soccerBall', 'iVBORw0KGgoAAAANSUhEUgAAAAkAAAAICAYAAAArzdW1AAAAR0lEQVR4nHWOwQ0AMQjDbMT+K3OfUqG251cUQkAWVVUMVAABogNqDyYFkGfDaN4yH+ZFjvtXsP34XZ/hfvzcbks1Wjwblv8BBZUeFkeBCjgAAAAASUVORK5CYII=');
loadSprite('cowboyRed', 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAAHCAYAAADNufepAAAAK0lEQVR4nGP8f5XhPwMUsDAcdIaxGZhgDMasvQjO/2nODIz/GRB64DIYHAAgcwjkHzPhtgAAAABJRU5ErkJggg==');
loadSprite('cowboyBlue', 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAAHCAYAAADNufepAAAAKklEQVR4nGM8uNriPwMUsNi95oaxGZhgDMasvQjO/2nODCweDMswlWFwAPe6B9dj33paAAAAAElFTkSuQmCC');
loadSprite('cowboyGun', 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAFElEQVR4nGMMCAj4z4ALBAQE/AcAP/UD4GG3IUAAAAAASUVORK5CYII=');

// Draws an image rotated around a custom pivot point (not necessarily the image center).
// If mirrorForLeft is true, angles where the sprite would face "leftward" are rendered as a
// horizontal mirror + partial rotation instead of a full rotation past 90°. This keeps
// vertically-asymmetric art (like a tank turret drawn above the hull) from flipping upside-down
// when the vehicle turns to face the other direction.
// Returns true if it actually drew the sprite, false if the image isn't ready yet (caller should fall back).
function drawRotatedSprite(ctx, img, x, y, angle, pivotX, pivotY, nativeW, nativeH, scale, rotateOffset, mirrorForLeft){
  if(!img || !img.complete || img.naturalWidth === 0) return false;
  ctx.save();
  ctx.translate(x, y);
  let a = angle + (rotateOffset||0);
  if(mirrorForLeft){
    while(a > Math.PI) a -= Math.PI*2;
    while(a <= -Math.PI) a += Math.PI*2;
    if(Math.cos(a) < 0){
      ctx.rotate(a + Math.PI);
      ctx.scale(-1,1);
    } else {
      ctx.rotate(a);
    }
  } else {
    ctx.rotate(a);
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, -pivotX*scale, -pivotY*scale, nativeW*scale, nativeH*scale);
  ctx.restore();
  return true;
}

// Draws an image flipped horizontally (no rotation) based on facing direction (1 = right, -1 = left).
// Used for side-view characters like the soccer players, where the art doesn't need to spin,
// just mirror depending on which way the character is currently moving/facing.
function drawFacingSprite(ctx, img, x, y, facing, pivotX, pivotY, nativeW, nativeH, scale){
  if(!img || !img.complete || img.naturalWidth === 0) return false;
  ctx.save();
  ctx.translate(x, y);
  if(facing < 0) ctx.scale(-1,1);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, -pivotX*scale, -pivotY*scale, nativeW*scale, nativeH*scale);
  ctx.restore();
  return true;
}
