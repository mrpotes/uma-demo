var express = require("express");
var redisLibrary = require("redis");
var uuid = require("node-uuid");
var http = require("http");
var fs = require("fs");
var querystring = require("querystring");
var jwt = require('jsonwebtoken');
var cookieParser = require('cookie-parser');
var multer  = require('multer')
var upload = multer({ dest: 'uploads/' });

var redis = redisLibrary.createClient();
var app = express();
app.use(cookieParser());

app.route("/users").get(function (req, res) {
    redis.get("users", function (err, reply) {
        res.send(reply ? reply : "[]");
    });
});

app.route("/me").get(function (req, res) {
    res.send("\"" + req.cookies.user + "\"");
});

app.route("/users/:user").get(function (req, res) {
    redis.hget("user_details", req.params.user, function (err, reply) {
        res.send(reply ? reply : "[]");
    });
});

app.route("/users/:user/photos").get(function (req, res) {
    redis.hget("photos", req.params.user, function (err, reply) {
        res.send(reply ? reply : "[]");
    });
}).post(upload.fields([{name:'image'},{name:"name"}]), function (req, res) {
    console.log(req.body);
    fs.readFile(req.files.image[0].path, function (err, data) {
        var id = uuid.v4();
        var newPath = __dirname + "/images/" + id;
        fs.writeFile(newPath, data, function (err) {
            redis.hget("tokens", req.params.user, function (err, reply) {
                var data = JSON.stringify({
                    "name" : req.body.name,
                    "scopes" : [ "View" ],
                    "type" : "http://rs.uma.com/rsets/photo",
                    "labels": ["Photos"]
                });
                var request = http.request({
                    hostname: "as.uma.com",
                    port: 8080,
                    path: "/openam/oauth2/demo/resource_set",
                    method: "POST",
                    headers: {
                        "Content-Length": data.length,
                        "Content-Type": "application/json",
                        "Authorization": "Bearer " + reply
                    }
                }, function (result) {
                    var data = "";
                    result.on("data", function (chunk) {
                        data += chunk;
                    });
                    result.on("end", function () {
                        redis.hget("photos", req.params.user, function (err, reply) {
                            if (!reply) {
                                res.redirect("/secure");
                            }
                            var photos = JSON.parse(reply);
                            var rsData = JSON.parse(data);
                            console.log(data);
                            photos.push({
                                id : id,
                                policyUri : rsData["user_access_policy_uri"].replace("oauth2/demo/",""),
                                rsId : rsData["_id"],
                                name : req.body.name
                            });
                            redis.hset("photos", req.params.user, JSON.stringify(photos), function (err, reply) {
                                res.redirect("/secure");
                            });
                        });
                    });
                });
                request.write(data);
                request.end();
            });
        });
    });
});

function check (req, rsId) {
    return new Promise(function (res, rej) {
        console.log("Checking permission to access");
        if (req.cookies.user && req.cookies.user === req.params.user) {
            res();
        } else if (req.headers.authorization) {
            var data = querystring.stringify({
                "client_id": "rs",
                "client_secret": "password"
            });
            var token = req.headers.authorization.substring(7);
            console.log("Introspecting token", req.headers, token);
            //console.log("Introspecting token", req.headers.authorization);
            var request = http.request({
                hostname: "as.uma.com",
                port: 8080,
                path: "/openam/oauth2/demo/introspect?token=" + token,
                method: "POST",
                headers: {
                    "Content-Length": data.length,
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            }, function (result) {
                var data = "";
                result.on("data", function (chunk) {
                    data += chunk;
                });
                result.on("end", function () {
                    console.log("Introspected token:", data);

                    var resp = JSON.parse(data);
                    if (resp["token_type"] === "requesting_party_token" && resp.permissions) {
                        var permissions = resp.permissions;
                        for (var i = 0; i < permissions.length; i++) {
                            console.log("Found permission", permissions[i]);
                            //permissions[i] should look like this:
                            //  { resource_set_id: '82eef546-4a5f-4dd5-80e9-879ee85ff6b87', scopes: [ 'View' ] }
                            console.log("req.params: " + JSON.stringify(req.params));
                            console.log("rsId: " + rsId); 
                            if (permissions[i]["resource_set_id"] === rsId && permissions[i].scopes.indexOf("View") > -1) {
                                console.log("Got permission");
                                res();
                                return;
                            }
                        }
                    }
                    rej();
                });
            });
            request.write(data);
            request.end();
        } else {
            console.log("No way to authorize request", req.cookies, req.headers);
            rej();
        }
    });
}
app.route("/users/:user/photos/:id").get(function (req, res) {
    redis.hget("photos", req.params.user, function (err, reply) {
        if (reply) {
            var photos = JSON.parse(reply);
            for (var i = 0; i < photos.length; i++) {
                if (photos[i].id === req.params.id) {
                    check(req, photos[i].rsId).then(function () {
                        console.log("Resource to send: " + __dirname + "/images/" + req.params.id); 
                        res.sendFile(__dirname + "/images/" + req.params.id);
                    }, function () {
                        console.log("Not yet authorized");
                        if (req.headers.authorization) {
                            res.sendStatus(403);
                        } else {
                            redis.hget("tokens", req.params.user, function (err, tokenReply) {
                                if (tokenReply) {
                                    var data = JSON.stringify({
                                        "resource_set_id": photos[i].rsId,
                                        "scopes": [ "View" ]
                                    });
                                    var requestOptions = {
                                        hostname: "as.uma.com",
                                        port: 8080,
                                        path: "/openam/uma/demo/permission_request",
                                        method: "POST",
                                        headers: {
                                            "Content-Length": data.length,
                                            "Content-Type": "application/x-www-form-urlencoded",
                                            "Authorization": "Bearer " + tokenReply
                                        }
                                    };
                                    console.log("Requesting ticket for", data);
                                    console.log("Request options", requestOptions);
                                    var request = http.request(requestOptions, function (result) {
                                        var data = "";
                                        result.on("data", function (chunk) {
                                            data += chunk;
                                        });
                                        result.on("end", function () {
                                            var resp = JSON.parse(data);
                                            console.log("Permission request response", resp);
                                            res.set("WWW-Authenticate", 'UMA as_uri="http://as.uma.com:8080/openam/uma/demo", ' +
                                                'ticket="' + resp.ticket + '"');
                                            res.sendStatus(401);
                                        });
                                    });
                                    request.write(data);
                                    request.end();
                                }
                            });
                        }
                    });
                    return;
                }
            }
            res.sendStatus(404);
        }
    });
});

app.route("/secure/code").get(function (req, res) {
    var data = querystring.stringify({
        "grant_type" : "authorization_code",
        "client_id" : "rs",
        "client_secret" : "password",
        "code" : req.query.code,
        "redirect_uri" : "http://rs.uma.com:9000/secure/code"
    });
    var request = http.request({
        hostname: "as.uma.com",
        port: 8080,
        path: "/openam/oauth2/demo/access_token",
        method: "POST",
        headers: {
            "Content-Length": data.length,
            "Content-Type": "application/x-www-form-urlencoded"
        }
    }, function (result) {
        var data = "";
        result.on("data", function (chunk) {
            data += chunk;
        });
        result.on("end", function () {
            var tokens = JSON.parse(data);
            console.log("tokens: " + JSON.stringify(tokens));
            var idToken = jwt.decode(tokens["id_token"]);
            console.log("Got id token", JSON.stringify(idToken, 2));
            if (!idToken) {
                console.log("Something wrong", tokens);
                res.send();
                return;
            }
            redis.get("users", function (error, reply) {
                var users;
                if (reply) {
                    var users = JSON.parse(reply);
                } else {
                    users = [];
                }
                var update = redis.multi();
                if (users.indexOf(idToken.sub) === -1) {
                    console.log("New user! id: ", idToken.sub);
                    users.push(idToken.sub);
                    update = update.set("users", JSON.stringify(users))
                        .hset("user_details", idToken.sub, JSON.stringify({ name : idToken.name }))
                        .hset("photos", idToken.sub, "[]");
                }
                update.hset("tokens", idToken.sub, tokens["access_token"])
                    .exec(function (error, reply) {
                        res.cookie('user', idToken.sub);
                        res.redirect("/secure");
                    });
            });
        });
    });
    request.write(data);
    request.end();
});

app.use(express.static("app"));

var server = app.listen(9000, "rs.uma.com", function () {
    var host = server.address().address;
    var port = server.address().port;

    console.log("Example app listening at http://%s:%s", host, port);
});
