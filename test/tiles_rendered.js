var testTile = function (
  prefix,
  tileSize = 256,
  z,
  x,
  y,
  format,
  status,
  scale,
  type,
) {
  if (scale) y += '@' + scale + 'x';
  var path =
    '/styles/' +
    prefix +
    '/' +
    tileSize +
    '/' +
    z +
    '/' +
    x +
    '/' +
    y +
    '.' +
    format;
  it(path + ' returns ' + status, function (done) {
    var test = supertest(app).get(path);
    test.expect(status);
    if (type) test.expect('Content-Type', type);
    test.end(done);
  });
};

const prefix = 'test-style';

describe('Raster tiles', function () {
  describe('valid requests', function () {
    describe('various formats', function () {
      testTile(prefix, 256, 0, 0, 0, 'png', 200, undefined, /image\/png/);
      testTile(prefix, 512, 0, 0, 0, 'png', 200, undefined, /image\/png/);
      testTile(prefix, 256, 0, 0, 0, 'jpg', 200, undefined, /image\/jpeg/);
      testTile(prefix, 512, 0, 0, 0, 'jpg', 200, undefined, /image\/jpeg/);
      testTile(prefix, 256, 0, 0, 0, 'jpeg', 200, undefined, /image\/jpeg/);
      testTile(prefix, 512, 0, 0, 0, 'jpeg', 200, undefined, /image\/jpeg/);
      testTile(prefix, 256, 0, 0, 0, 'webp', 200, undefined, /image\/webp/);
      testTile(prefix, 512, 0, 0, 0, 'webp', 200, undefined, /image\/webp/);
    });

    describe('different coordinates and scales', function () {
      testTile(prefix, 256, 1, 0, 0, 'png', 200);
      testTile(prefix, 512, 1, 0, 0, 'png', 200);
      testTile(prefix, 256, 0, 0, 0, 'png', 200, 2);
      testTile(prefix, 512, 0, 0, 0, 'png', 200, 2);
      testTile(prefix, 256, 0, 0, 0, 'png', 200, 3);
      testTile(prefix, 512, 0, 0, 0, 'png', 200, 3);
      testTile(prefix, 256, 2, 1, 1, 'png', 200, 3);
      testTile(prefix, 512, 2, 1, 1, 'png', 200, 3);
    });
  });

  describe('invalid requests return 4xx', function () {
    testTile('non_existent', 256, 0, 0, 0, 'png', 404);
    testTile(prefix, 256, -1, 0, 0, 'png', 400);
    testTile(prefix, 256, 25, 0, 0, 'png', 400);
    testTile(prefix, 256, 0, 1, 0, 'png', 400);
    testTile(prefix, 256, 0, 0, 1, 'png', 400);
    testTile(prefix, 256, 0, 0, 0, 'gif', 400);
    testTile(prefix, 256, 0, 0, 0, 'pbf', 400);

    testTile(prefix, 256, 0, 0, 0, 'png', 400, 1);
    testTile(prefix, 256, 0, 0, 0, 'png', 400, 5);

    testTile(prefix, 300, 0, 0, 0, 'png', 400);
  });
});
