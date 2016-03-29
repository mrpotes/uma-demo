var express = require("express");
var http = require("http");
var fs = require("fs");
var querystring = require("querystring");
var jwt = require('jsonwebtoken');
var cookieParser = require('cookie-parser');

var app = express();
app.use(cookieParser());

app.route("/users").get(function (req, res) {
    console.log("Getting users");
    http.get("http://rs.uma.com:9000/users", function(result) {
        result.pipe(res);
    });
});

app.route("/users/:user/photos").get(function (req, res) {
    console.log("Getting photos for " + req.params.user);
    http.get("http://rs.uma.com:9000/users/" + req.params.user + "/photos", function(result) {
        result.pipe(res);
    });
});

app.route("/users/:user/photos/:id").get(function (req, res) {
    var bufs = [];
    var requestOptions = {
        hostname: "rs.uma.com",
        port: 9000,
        path: "/users/" + req.params.user + "/photos/" + req.params.id,
    };
    if (req.cookies.rpt) {
        requestOptions.headers = { "Authorization": "Bearer " + req.cookies.rpt };
    }
    console.log("Loading photo:", requestOptions);
    http.get(requestOptions, function (result) {
        result.on("data", function (chunk) {
            //console.log("chunk");
            bufs.push(chunk);
        });
        result.on("end", function () {
            console.log("Got response", result.headers);
            if (result.statusCode === 401 && result.headers["www-authenticate"] && result.headers["www-authenticate"].startsWith("UMA")) {
                console.log("401 and www-authenticate and starts with UMA");
                var ticket = result.headers["www-authenticate"];
                ticket = ticket.substring(ticket.indexOf("ticket=") + "ticket='".length);
                ticket = ticket.substring(0, ticket.length - 1);
                console.log("Got ticket:", ticket);
                var data = JSON.stringify({ ticket: ticket });
                var request = http.request({
                    hostname: "as.uma.com",
                    port: 8080,
                    path: "/openam/uma/demo/authz_request",
                    method: "POST",
                    headers: {
                        "Content-Length": data.length,
                        "Content-Type": "application/json",
                        "Authorization": "Bearer " + req.cookies.aat
                    }
                }, function (result) {
                    var data = "";
                    result.on("data", function (chunk) {
                        data += chunk;
                    });
                    result.on("end", function () {
                        var tokens = JSON.parse(data);
                        console.log("Got response", tokens);
                        req.cookies.rpt = tokens.rpt;
                        res.cookie('rpt', tokens.rpt);
                        res.redirect("/users/" + req.params.user + "/photos/" + req.params.id);
                    });
                });
                request.write(data);
                request.end();
            } else {
                for (buf in bufs) {
                  res.write(bufs[buf]);
                }
                //while (bufs.length) {
                  //buf = bufs.pop() + buf;
                //}
                //console.log("buf:" + buf);
                res.end();
            }
        })
    });
});

app.route("/secure/code").get(function (req, res) {
    var data = querystring.stringify({
        "grant_type" : "authorization_code",
        "client_id" : "client",
        "client_secret" : "password",
        "code" : req.query.code,
        "redirect_uri" : "http://client.uma.com:10000/secure/code"
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
            var idToken = jwt.decode(tokens["id_token"]);
            if (!idToken) {
                console.log("Something wrong", tokens);
                res.send();
                return;
            }
            res.cookie('user', idToken.sub);
            res.cookie('aat', tokens["access_token"]);
            res.redirect("/secure");
        });
    });
    request.write(data);
    request.end();
});

app.use(express.static("app"));

var server = app.listen(10000, "rs.uma.com", function () {
    var host = server.address().address;
    var port = server.address().port;

    console.log("Example app listening at http://%s:%s", host, port);
});
