## UMA Demo

This repo contains a demo UMA resource server and client that could
interact with an UMA Authentication Server such as OpenAM.

Instructions for use:
* Install Redis and NodeJS locally
* `npm install` each of the two sub directories
* Set up your `/etc/hosts` file to have domains `as.uma.com`, `rs.uma.com`
and `client.uma.com` pointing at localhost.
* Run redis
* Install OpenAM on port 8080 using host `as.uma.com`
   * Set up a `demo` realm
   * Set up UMA for the realm, configure not to need elevated trust
   * Create an UMA RS OAuth2 agent called `rs` with password `password`
      * Scopes: uma_protection, openid, profile
      * Redirection_uri: http://rs.uma.com:9000/secure/code
      * Token Endpoint Authentication Method: client_secret_post
   * Create an UMA Client OAuth2 agent called `client` with password `password`
      * Scopes: uma_authorization, openid, profile
      * Redirection_uri: http://client.uma.com:10000/secure/code
      * Token Endpoint Authentication Method: client_secret_post
* Run the rs and client node apps

You should be able to hit the RS at http://rs.uma.com:9000 and the client at
http://client.uma.com:10000
