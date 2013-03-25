var _ = require('underscore');
var MBTiles = require('mbtiles');

module.exports = MBTiles;

// Implements carmen#search method.
MBTiles.prototype.search = function(query, id, callback) {
    var arg = query ? query : id;
    var sql = query
        ? 'SELECT c.id, c.text, c.zxy FROM carmen c WHERE c.text MATCH(?) LIMIT 1000'
        : 'SELECT c.id, c.text, c.zxy FROM carmen c WHERE c.id MATCH(?) LIMIT 1000';
    this._db.all(sql, arg, function(err, rows) {
        if (err) return callback(err);
        rows = rows.map(function(row) {
            row.zxy = row.zxy.split(',');
            return row;
        });
        callback(null, rows);
    });
};

// Implements carmen#feature method.
MBTiles.prototype.feature = function(id, callback) {
    this._db.get('SELECT key_name AS id, key_json AS data FROM keymap WHERE key_name = ?', id, function(err, row) {
        if (err) return callback(err);
        try { return callback(null, JSON.parse(row.data)); }
        catch(err) { return callback(err); }
    });
};

// Implements carmen#index method.
MBTiles.prototype.index = function(id, text, doc, zxy, callback) {
    var remaining = 2;
    var done = function(err) {
        if (err) {
            remaining = -1;
            callback(err);
        } else if (!--remaining) {
            callback(null);
        }
    };
    this._db.run('REPLACE INTO carmen (id, text, zxy) VALUES (?, ?, ?)', id, text, zxy.join(','), done);
    this._db.run('REPLACE INTO keymap (key_name, key_json) VALUES (?, ?)', id, JSON.stringify(doc), done);
};

// Implements carmen#indexable method.
MBTiles.prototype.indexable = function(pointer, callback) {
    pointer = pointer || 0;
    this.getInfo(function(err, info) {
        this._db.all("SELECT k.key_name, k.key_json, GROUP_CONCAT(zoom_level||'/'||tile_column ||'/'||tile_row,',') AS zxy FROM keymap k JOIN grid_key g ON k.key_name = g.key_name JOIN map m ON g.grid_id = m.grid_id WHERE m.zoom_level=? GROUP BY k.key_name LIMIT 10000 OFFSET ?;", info.maxzoom, pointer, function(err, rows) {
            if (err) return callback(err);
            var docs = rows.map(function(row) {
                var doc = {};
                doc.id = row.key_name;
                doc.doc = JSON.parse(row.key_json);
                // @TODO the doc field name for searching probably (?) belongs
                // in `metadata` and should be un-hardcoded in the future.
                doc.text = doc.doc.search;
                doc.zxy = row.zxy.split(',');
                return doc;
            });
            pointer += 10000;
            return callback(null, docs, pointer);
        }.bind(this));
    }.bind(this));
};

// Adds carmen schema to startWriting.
MBTiles.prototype.startWriting = _(MBTiles.prototype.startWriting).wrap(function(parent, callback) {
    parent.call(this, function(err) {
        if (err) return callback(err);
        var sql = '\
        CREATE INDEX IF NOT EXISTS map_grid_id ON map (grid_id);\
        CREATE VIRTUAL TABLE carmen USING fts4(id,text,zxy,tokenize=simple);'
        this._db.exec(sql, callback);
    }.bind(this));
});
