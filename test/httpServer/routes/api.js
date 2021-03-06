const step = require('mocha-steps').step;
const should = require('chai').should();
const supertest = require('supertest');
const path = require('path');
const rewire = require('rewire');
const Config = require('../../../lib/config');
const HTTPServer = require('../../../lib/httpServer');
const DB = require('../../../lib/db');
const Bucket = require('../../../lib/bucket');
const Artifact = require('../../../lib/artifact');
const Webhook = rewire('../../../lib/webhook');
const Auth = rewire('../../../lib/auth');
const Metric = require('../../../lib/metric');

const EMBEDDED_MONGO = true;
const KEEP_DATABASE = false;
const timeout = ms => new Promise(res => setTimeout(res, ms));

let Mongoose = null;
let mongoose = null;
let Mockgoose = null;
let mockgoose = null;
if (EMBEDDED_MONGO) {
    Mongoose = require('mongoose').Mongoose;
    mongoose = new Mongoose();
    Mockgoose = require('mockgoose').Mockgoose;
    mockgoose = new Mockgoose(mongoose);
}

describe('HTTPServer', async () => {

    let context = null;

    const createContext = async () => {
        if (EMBEDDED_MONGO) await mockgoose.prepareStorage();
        const config = new Config('mongodb://localhost/test', 'test/data/storage');
        const dbService = new DB(config);
        await dbService.connect();
        const authService = new Auth(dbService.metadata);
        const bucketService = new Bucket(dbService.storage, dbService.metadata, authService);
        const webhookService = new Webhook(dbService.metadata);
        const artifactServer = new Artifact(dbService.storage, dbService.metadata, webhookService, authService);
        const metricService = new Metric(authService);
        const server = new HTTPServer(dbService, bucketService, artifactServer, webhookService, authService, metricService);
        return {
            server,
            dbService,
            authService,
            metricService,
            config,
            initialToken: await authService.getFirstTimeToken(),
            userInvalid: {
                username: 'invaliduser@totvs.com.br',
                password: 'inv'
            },
            userUser1: {
                username: 'user1@totvs.com.br',
                password: 'user1user1',
                roles: ['user']
            },
            userUser2: {
                username: 'user2@totvs.com.br',
                password: 'user2user2',
                roles: ['user']
            },
            userGuest1: {
                username: 'guest1@totvs.com.br',
                password: 'guest1guest1',
                roles: ['guest']
            },
            userSuperuser1: {
                username: 'superuser1@totvs.com.br',
                password: 'superuser1superuser1',
                roles: ['superuser']
            },
            userLDAPUser1: {
                username: 'riemann',
                password: 'password',
                roles: ['user']
            }
        };
    };

    const deleteContext = async (context) => {
        await context.dbService.destroy();
        await context.dbService.disconnect();        
    };

    before(async () => {
        context = await createContext();
    });

    after(async () => {
        if (context) {
            if (!KEEP_DATABASE) await deleteContext(context);
            if (EMBEDDED_MONGO) {
                await mockgoose.helper.reset();
                await mongoose.disconnect();
                mockgoose.mongodHelper.mongoBin.childProcess.kill('SIGTERM');
            }
        }
    });

    describe('get /api/ping', async () => {
        // get ping -> OK
        step('should ping', async () => {
            return await supertest(context.server.app)
                .get('/api/ping')
                .expect(200);
        });
    });

    describe('get /api/throw', async () => {
        // get throw -> Error 500
        step('should throw', async () => {
            await supertest(context.server.app)
                .get('/api/throw')
                .expect(500);
        });
    });

    describe('post /api/users', async () => {
        step('should create user 1', async () => {
            return await supertest(context.server.app)
                .post('/api/users')
                .set({ Authorization: context.initialToken })
                .send(context.userUser1)
                .expect(200);
        });

        step('should create user 2', async () => {
            return await supertest(context.server.app)
                .post('/api/users')
                .set({ Authorization: context.initialToken })
                .send(context.userUser2)
                .expect(200);
        });

        step('should create guest 1', async () => {
            return await supertest(context.server.app)
                .post('/api/users')
                .set({ Authorization: context.initialToken })
                .send(context.userGuest1)
                .expect(200);
        });

        step('should create user superuser 1', async () => {
            return await supertest(context.server.app)
                .post('/api/users')
                .set({ Authorization: context.initialToken })
                .send(context.userSuperuser1)
                .expect(200);
        });

        step('should not create an invalid user', async () => {
            return await supertest(context.server.app)
                .post('/api/users')
                .set({ Authorization: context.initialToken })
                .send(context.userInvalid)
                .expect(400);
        });
    });

    describe('post /api/tokens', async () => {
        step('should get token for user 1', async () => {
            const tokenResponse = await supertest(context.server.app)
                .post('/api/tokens')
                .send(context.userUser1)
                .expect(200);
            context.tokenUserUser1 = tokenResponse.body.token;
        });

        step('should get token for user 2', async () => {
            const tokenResponse = await supertest(context.server.app)
                .post('/api/tokens')
                .send(context.userUser2)
                .expect(200);
            context.tokenUserUser2 = tokenResponse.body.token;
        });

        step('should get token for an invaid user', async () => {
            await supertest(context.server.app)
                .post('/api/tokens')
                .send({ username: 'none', password: 'none' })
                .expect(401);
        });

        step('should get token for guest 1', async () => {
            const tokenResponse = await supertest(context.server.app)
                .post('/api/tokens')
                .send(context.userGuest1)
                .expect(200);
            context.tokenUserGuest1 = tokenResponse.body.token;
        });

        step('should get token for user superuser 1', async () => {
            const tokenResponse = await supertest(context.server.app)
                .post('/api/tokens')
                .set({ Authorization: context.initialToken })
                .send(context.userSuperuser1)
                .expect(200);
            context.tokenUserSuperuser1 = tokenResponse.body.token;
        });
    });

    describe('get /api/tokens/:token', async () => {
        step('should get token data from user 1 token', async () => {
            const tokenDataResponse = await supertest(context.server.app)
                .get(`/api/tokens/${context.tokenUserUser1}`)
                .expect(200);
            should.exist(tokenDataResponse.body);
            tokenDataResponse.body.should.be.an('object');
        });
    });

    describe('put /api/users', async () => {
        step('should change user 2 password using user 2', async () => {
            const newPassword = 'user2user2';
            await supertest(context.server.app)
                .put('/api/users')
                .set({ Authorization: context.tokenUserUser2 })
                .send({
                    username: context.userUser2.username,
                    password: newPassword
                })
                .expect(200);

            context.userUser2.password = newPassword;

            const tokenResponse = await supertest(context.server.app)
                .post('/api/tokens')
                .send(context.userUser2)
                .expect(200);
            context.tokenUserUser2 = tokenResponse.body.token;
        });

        step('should not change user 2 role to superuser using user 2', async () => {
            await supertest(context.server.app)
                .put('/api/users/')
                .set({ Authorization: context.tokenUserUser2 })
                .send({
                    username: context.userUser2.username,
                    roles: ['superuser']
                })
                .expect(403);
        });

        step('should change user 2 role to superuser using superuser', async () => {
            await supertest(context.server.app)
                .put('/api/users/')
                .set({ Authorization: context.tokenUserSuperuser1 })
                .send({
                    username: context.userUser2.username,
                    roles: ['superuser']
                })
                .expect(200);
        });

    });

    describe('get /api/users', async () => {
        step('should get all users using superuser 1', async () => {
            const users = await supertest(context.server.app)
                .get('/api/users')
                .set({ Authorization: context.tokenUserSuperuser1 })
                .expect(200);
            users.body.should.be.an('array');
        });

        step('should not get all users using user 1', async () => {
            return await supertest(context.server.app)
                .get('/api/users')
                .set({ Authorization: context.tokenUserUser1 })
                .expect(403);
        });

        step('update config adding ldap', async () => {
            context.authService.ldapConfig = [{
                url: 'ldap://ldap.forumsys.com:389',
                bindDN: 'cn=read-only-admin,dc=example,dc=com',
                bindCredentials: 'password',
                searchBase: 'dc=example,dc=com',
                searchFilter: '(uid={{username}})'
            }];
        });

        step('get token for ldap user 1 using ldap user', async () => {
            const tokenResponse = await supertest(context.server.app)
                .post('/api/tokens')
                .send(context.userLDAPUser1)
                .expect(200);
            context.tokenUserLDAPUser1 = tokenResponse.body.token;
        });
    });

    describe('get /api/buckets', async () => {
        // get buckets -> []
        step('should get buckets using user 1', async () => {
            const bucketsResult = await supertest(context.server.app)
                .get('/api/buckets')
                .set({ Authorization: context.tokenUserUser1 })
                .expect(200);
            should.exist(bucketsResult.body);
            bucketsResult.body.should.be.an('array').and.to.have.lengthOf(0);
        });
    });

    describe('post /api/buckets', async () => {
        // post bucket1 -> bucket1
        step('should create the bucket 1 using user 1', async () => {
            const bucketsResult = await supertest(context.server.app)
                .post('/api/buckets')
                .set({ Authorization: context.tokenUserUser1 })
                .send({
                    name: 'bucket1',
                    retentionPolicy: [{
                        filter: {
                            name: 'artifact',
                            version: '1.0',
                            metadata: {
                                os: 'all'
                            }
                        },
                        totalSize: '1MB',
                        fileCount: 5,
                        age: '15 days'
                    }],
                    template: {
                        fileName: '{name}-{version}-{tag}-{os}-{arch}-{language}-{country}-{customVersion}.zip',
                        properties: {
                            tag: {
                                type: 'string'
                            },
                            os: {
                                type: 'string',
                                oneOf: [
                                    'windows',
                                    'linux',
                                    'macos',
                                    'all'
                                ],
                                default: 'all'
                            },
                            arch: {
                                type: 'string',
                                oneOf: [
                                    'x86',
                                    'x86_64',
                                    'all'
                                ],
                                default: 'all'
                            },
                            language: {
                                type: 'string',
                                default: 'all'
                            },
                            country: {
                                type: 'string',
                                default: 'all'
                            },
                            customVersion: {
                                default: 'none'
                            }
                        }
                    }
                })
                .expect(200);
            should.exist(bucketsResult.body);
            bucketsResult.body.should.be.an('object');
        });

        // post bucket2 -> bucket2
        step('should create the bucket 2 using user 1', async () => {
            const bucketsResult = await supertest(context.server.app)
                .post('/api/buckets')
                .set({ Authorization: context.tokenUserUser1 })
                .send({
                    name: 'bucket2',
                    retentionPolicy: [{
                        filter: {
                            name: 'artifact',
                            version: '1.0',
                            metadata: {
                                os: 'all'
                            }
                        },
                        totalSize: '1MB',
                        fileCount: 5,
                        age: '15 days'
                    }],
                    template: {
                        fileName: '{name}-{version}-{tag}-{os}-{arch}-{language}-{country}-{customVersion}.zip',
                        properties: {
                            tag: {
                                type: 'string'
                            },
                            os: {
                                type: 'string',
                                oneOf: [
                                    'windows',
                                    'linux',
                                    'macos',
                                    'all'
                                ],
                                default: 'all'
                            },
                            arch: {
                                type: 'string',
                                oneOf: [
                                    'x86',
                                    'x86_64',
                                    'all'
                                ],
                                default: 'all'
                            },
                            language: {
                                type: 'string',
                                default: 'all'
                            },
                            country: {
                                type: 'string',
                                default: 'all'
                            },
                            customVersion: {
                                default: 'none'
                            }
                        }
                    }
                })
                .expect(200);
            should.exist(bucketsResult.body);
            bucketsResult.body.should.be.an('object');
        });

        // post bucket3 -> 403
        step('should not create the bucket 3 using guest 1', async () => {
            return await supertest(context.server.app)
                .post('/api/buckets')
                .set({ Authorization: context.tokenUserGuest1 })
                .send({
                    name: 'bucket3'
                })
                .expect(403);
        });
    });

    describe('get /api/buckets/:bucketName', async () => {
        // get bucket0 -> Error 404
        step('should not get inexistent bucket using user 1', async () => {
            return await supertest(context.server.app)
                .get('/api/buckets/bucket0')
                .set({ Authorization: context.tokenUserUser1 })
                .expect(404);
        });

        // get bucket1 -> bucket1
        step('should get bucket 1 using user 1', async () => {
            const bucketsResult = await supertest(context.server.app)
                .get('/api/buckets/bucket1')
                .set({ Authorization: context.tokenUserUser1 })
                .expect(200);
            should.exist(bucketsResult.body);
            bucketsResult.body.should.be.an('object');
            bucketsResult.body.name.should.be.an('string').equal('bucket1');
        });
    });

    describe('put /api/buckets/:bucketName/artifacts/:artifactName/:version?', async () => {
        // put bucket1/artifact1/1.0 -> bucket1/artifact1/1.0
        step('should create an artifact with version 1.0 using user 1', async () => {
            const result = await supertest(context.server.app)
                .put('/api/buckets/bucket1/artifacts/artifact1/1.0')
                .set({ Authorization: context.tokenUserUser1 })
                .attach('artifact', path.resolve(__dirname, 'file.zip'))
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('object');
            result.body.version.should.be.an('string').equal('1.0');
            context.updatedAt = result.body.updatedAt;
        });

        // put bucket1/artifact1/1.0 using guest 1 -> 403
        step('should not create an artifact with version 1.0 using guest 1', async () => {
            return await supertest(context.server.app)
                .put('/api/buckets/bucket1/artifacts/artifact1/1.0')
                .set({ Authorization: context.tokenUserGuest1 })
                .attach('artifact', path.resolve(__dirname, 'file.zip'))
                .expect(403);
        });

        // put bucket1/artifact1/1.0 -> bucket1/artifact1/1.0 with a greater updatedAt
        step('should create an artifact with version 1.0 but with a greater updatedAt using user 1', async () => {
            const result = await supertest(context.server.app)
                .put('/api/buckets/bucket1/artifacts/artifact1/1.0')
                .set({ Authorization: context.tokenUserUser1 })
                .attach('artifact', path.resolve(__dirname, 'file.zip'))
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('object');
            result.body.version.should.be.an('string').equal('1.0');
            Date.parse(result.body.updatedAt).should.be.greaterThan(Date.parse(context.updatedAt));
        });

        // put bucket1/artifact1/2.0 -> bucket1/artifact1/2.0
        step('should create an artifact with version 2.0 using user 1', async () => {
            const result = await supertest(context.server.app)
                .put('/api/buckets/bucket1/artifacts/artifact1/2.0')
                .set({ Authorization: context.tokenUserUser1 })
                .attach('artifact', path.resolve(__dirname, 'file.zip'))
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('object');
            result.body.version.should.be.an('string').equal('2.0');
        });

        // put bucket1/artifact3/1.0?os=linux -> bucket1/artifact3/1.0?os=linux&arch=all
        step('should create an artifact with version 1.0 and metadata os=linux using user 1', async () => {
            const result = await supertest(context.server.app)
                .put('/api/buckets/bucket1/artifacts/artifact3/1.0')
                .set({ Authorization: context.tokenUserUser1 })
                .field({
                    os: 'linux'
                })
                .attach('artifact', path.resolve(__dirname, 'file.zip'))
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('object');
            result.body.version.should.be.an('string').equal('1.0');
            result.body.metadata.should.be.an('object');
            result.body.metadata.os.should.be.equal('linux');
            result.body.metadata.arch.should.be.equal('all');
        });

        // put bucket1/artifact3/1.0?os=linux&arch=x86 -> bucket1/artifact3/1.0?os=linux&arch=x86
        step('should create an artifact with version 1.0 and metadata os=linux and arch=x86 using user 1', async () => {
            const result = await supertest(context.server.app)
                .put('/api/buckets/bucket1/artifacts/artifact3/1.0')
                .set({ Authorization: context.tokenUserUser1 })
                .field({
                    os: 'linux',
                    arch: 'x86'
                })
                .attach('artifact', path.resolve(__dirname, 'file.zip'))
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('object');
            result.body.version.should.be.an('string').equal('1.0');
            result.body.metadata.should.be.an('object');
            result.body.metadata.os.should.be.equal('linux');
            result.body.metadata.arch.should.be.equal('x86');
        });

        // put bucket1/artifact3/1.0?os=macos -> bucket1/artifact3/1.0?os=macos&arch=all
        step('should create an artifact with version 1.0 and metadata os=macos using user 1', async () => {
            const result = await supertest(context.server.app)
                .put('/api/buckets/bucket1/artifacts/artifact3/1.0')
                .set({ Authorization: context.tokenUserUser1 })
                .field({
                    os: 'macos'
                })
                .attach('artifact', path.resolve(__dirname, 'file.zip'))
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('object');
            result.body.version.should.be.an('string').equal('1.0');
            result.body.metadata.should.be.an('object');
            result.body.metadata.os.should.be.equal('macos');
            result.body.metadata.arch.should.be.equal('all');
        });

        // put bucket1/artifact3/1.0?os=windows&arch=x86 -> bucket1/artifact3/1.0?os=windows&arch=x86
        step('should create an artifact with version 1.0 and metadata os=windows and arch=x86 using user 1', async () => {
            const result = await supertest(context.server.app)
                .put('/api/buckets/bucket1/artifacts/artifact3/1.0')
                .set({ Authorization: context.tokenUserUser1 })
                .field({
                    os: 'windows',
                    arch: 'x86'
                })
                .attach('artifact', path.resolve(__dirname, 'file.zip'))
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('object');
            result.body.version.should.be.an('string').equal('1.0');
            result.body.metadata.should.be.an('object');
            result.body.metadata.os.should.be.equal('windows');
            result.body.metadata.arch.should.be.equal('x86');
        });
    });

    describe('get /api/buckets/:bucketName/artifacts/:artifactName/:version? using user 1 (application/zip)', async () => {
        // get zip bucket1/artifact1 -> bucket1/artifact1/2.0?os=all&arch=all
        step('should get the artifact 1 without specifying the version', async () => {
            const result = await supertest(context.server.app)
                .get('/api/buckets/bucket1/artifacts/artifact1')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/zip')
                .buffer(true)
                .responseType('blob')
                .expect(200);
            should.exist(result);
            result.type.should.be.equal('application/zip');
            result.body.should.be.an.instanceof(Buffer);
            result.headers['content-disposition'].should.include('artifact1-2.0-undefined-all-all-all-all-none.zip');
        });

        // get zip bucket1/artifact1/latest -> bucket1/artifact1/2.0?os=all&arch=all
        step('should get the latest artifact 1 using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/buckets/bucket1/artifacts/artifact1/latest')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/zip')
                .buffer(true)
                .responseType('blob')
                .expect(200);
            should.exist(result);
            result.type.should.be.equal('application/zip');
            result.body.should.be.an.instanceof(Buffer);
            result.headers['content-disposition'].should.include('artifact1-2.0-undefined-all-all-all-all-none.zip');
        });

        // get zip bucket1/artifact1/oldest -> bucket1/artifact1/1.0?os=all&arch=all
        step('should get the oldest artifact 1 using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/buckets/bucket1/artifacts/artifact1/oldest')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/zip')
                .buffer(true)
                .responseType('blob')
                .expect(200);
            should.exist(result);
            result.type.should.be.equal('application/zip');
            result.body.should.be.an.instanceof(Buffer);
            result.headers['content-disposition'].should.include('artifact1-1.0-undefined-all-all-all-all-none.zip');
        });

        // get zip bucket1/artifact1/1.0 -> bucket1/artifact1/1.0?os=all&arch=all
        step('should get the artifact 1 with version 1.0 using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/buckets/bucket1/artifacts/artifact1/1.0')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/zip')
                .buffer(true)
                .responseType('blob')
                .expect(200);
            should.exist(result);
            result.type.should.be.equal('application/zip');
            result.body.should.be.an.instanceof(Buffer);
            result.headers['content-disposition'].should.include('artifact1-1.0-undefined-all-all-all-all-none.zip');
        });

        // get zip bucket1/artifact1/2.0 -> bucket1/artifact1/2.0?os=all&arch=all
        step('should get the artifact 1 with version 2.0 using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/buckets/bucket1/artifacts/artifact1/2.0')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/zip')
                .buffer(true)
                .responseType('blob')
                .expect(200);
            should.exist(result);
            result.type.should.be.equal('application/zip');
            result.body.should.be.an.instanceof(Buffer);
            result.headers['content-disposition'].should.include('artifact1-2.0-undefined-all-all-all-all-none.zip');
        });

        // get zip bucket1/artifact1/3.0 -> Error 404
        step('should not get the artifact 1 with version 3.0 using user 1', async () => {
            return await supertest(context.server.app)
                .get('/api/buckets/bucket1/artifacts/artifact1/3.0')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/zip')
                .buffer(true)
                .responseType('blob')
                .expect(404);
        });

        // get zip bucket1/artifact2 -> Error 404        
        step('should not get the artifact 2 without specifying the version using user 1', async () => {
            return await supertest(context.server.app)
                .get('/api/buckets/bucket1/artifacts/artifact2')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/zip')
                .buffer(true)
                .responseType('blob')
                .expect(404);
        });

        // get zip bucket1/artifact2/latest -> Error 404
        step('should not get the latest artifact 2 using user 1', async () => {
            return await supertest(context.server.app)
                .get('/api/buckets/bucket1/artifacts/artifact2/latest')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/zip')
                .buffer(true)
                .responseType('blob')
                .expect(404);
        });

        // get zip bucket1/artifact2/oldest -> Error 404
        step('should not get the oldest artifact 2 using user 1', async () => {
            return await supertest(context.server.app)
                .get('/api/buckets/bucket1/artifacts/artifact2/oldest')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/zip')
                .buffer(true)
                .responseType('blob')
                .expect(404);
        });

        // get zip bucket1/artifact3/1.0?os=linux -> bucket1/artifact3/1.0?os=linux&arch=all
        step('should get the artifact 3 with version 1.0 and metadata os=linux using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/buckets/bucket1/artifacts/artifact3/1.0?os=linux')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/zip')
                .buffer(true)
                .responseType('blob')
                .expect(200);
            should.exist(result);
            result.type.should.be.equal('application/zip');
            result.body.should.be.an.instanceof(Buffer);
            result.headers['content-disposition'].should.include('artifact3-1.0-undefined-linux-all-all-all-none.zip');
        });

        // get zip bucket1/artifact3/1.0?os=linux&arch=x86 -> bucket1/artifact3/1.0?os=linux&arch=x86
        step('should get the artifact 3 with version 1.0 and metadata os=linux and arch=x86 using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/buckets/bucket1/artifacts/artifact3/1.0?os=linux&arch=x86')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/zip')
                .buffer(true)
                .responseType('blob')
                .expect(200);
            should.exist(result);
            result.type.should.be.equal('application/zip');
            result.body.should.be.an.instanceof(Buffer);
            result.headers['content-disposition'].should.include('artifact3-1.0-undefined-linux-x86-all-all-none.zip');
        });

        // get zip bucket1/artifact3/1.0?os=macos -> bucket1/artifact3/1.0?os=macos&arch=all
        step('should get the artifact 3 with version 1.0 and metadata os=macos using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/buckets/bucket1/artifacts/artifact3/1.0?os=macos')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/zip')
                .buffer(true)
                .responseType('blob')
                .expect(200);
            should.exist(result);
            result.type.should.be.equal('application/zip');
            result.body.should.be.an.instanceof(Buffer);
            result.headers['content-disposition'].should.include('artifact3-1.0-undefined-macos-all-all-all-none.zip');
        });

        // get zip bucket1/artifact3/1.0?os=latest -> bucket1/artifact3/1.0?os=macos&arch=all
        step('should get the artifact 3 with version 1.0 and metadata os=latest using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/buckets/bucket1/artifacts/artifact3/1.0?os=latest')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/zip')
                .buffer(true)
                .responseType('blob')
                .expect(200);
            should.exist(result);
            result.type.should.be.equal('application/zip');
            result.body.should.be.an.instanceof(Buffer);
            result.headers['content-disposition'].should.include('artifact3-1.0-undefined-macos-all-all-all-none.zip');
        });

        // get zip bucket1/artifact3/1.0?os=windows -> bucket1/artifact3/1.0?os=windows&arch=all -> Error 404
        step('should get the artifact 3 with version 1.0 and metadata os=windows using user 1', async () => {
            return await supertest(context.server.app)
                .get('/api/buckets/bucket1/artifacts/artifact3/1.0?os=windows')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/zip')
                .buffer(true)
                .responseType('blob')
                .expect(404);
        });

        // get zip bucket1/artifact3/1.0?os=all -> bucket1/artifact3/1.0?os=all&arch=all -> Error 404
        step('should get the artifact 3 with version 1.0 and metadata os=all using user 1', async () => {
            return await supertest(context.server.app)
                .get('/api/buckets/bucket1/artifacts/artifact3/1.0?os=all')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/zip')
                .buffer(true)
                .responseType('blob')
                .expect(404);
        });
    });

    describe('get /api/artifacts/search', async () => {
        // get bucket1/artifact1 -> [bucket1/artifact1/1.0, bucket1/artifact1/2.0]
        step('should get all artifacts 1 without specifying a version using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/artifacts/search?bucket=bucket1&artifact=artifact1')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/json')
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('array').and.to.have.lengthOf(2);
            result.body[0].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact1',
                    version: '2.0',
                    normalizedVersion: '0000000002.0000000000',
                    path: path.normalize('bucket1/artifact1-2.0-undefined-all-all-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[0].updatedAt,
                    createdAt: result.body[0].createdAt,
                    uploads: result.body[0].uploads,
                    downloads: result.body[0].downloads,
                    metadata: { arch: 'all', os: 'all', language: 'all', country: 'all', customVersion: 'none' }
                });
            result.body[1].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact1',
                    version: '1.0',
                    normalizedVersion: '0000000001.0000000000',
                    path: path.normalize('bucket1/artifact1-1.0-undefined-all-all-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[1].updatedAt,
                    createdAt: result.body[1].createdAt,
                    uploads: result.body[1].uploads,
                    downloads: result.body[1].downloads,
                    metadata: { arch: 'all', os: 'all', language: 'all', country: 'all', customVersion: 'none' }
                });
        });

        // get bucket1/artifact2 -> []
        step('should not get the artifact 2 using user 1', async () => {
            return await supertest(context.server.app)
                .get('/api/artifacts/search?bucket=bucket1&artifact=artifact2')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/json')
                .expect(200);
        });

        // get bucket1/artifact1/latest -> [ bucket1/artifact1/2.0, bucket1/artifact1/1.0 ]
        step('should get the latest artifacts 1 using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/artifacts/search?bucket=bucket1&artifact=artifact1&version=latest')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/json')
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('array').and.to.have.lengthOf(2);
            result.body[0].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact1',
                    version: '2.0',
                    normalizedVersion: '0000000002.0000000000',
                    path: path.normalize('bucket1/artifact1-2.0-undefined-all-all-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[0].updatedAt,
                    createdAt: result.body[0].createdAt,
                    uploads: result.body[0].uploads,
                    downloads: result.body[0].downloads,
                    metadata: { arch: 'all', os: 'all', language: 'all', country: 'all', customVersion: 'none' }
                });
            result.body[1].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact1',
                    version: '1.0',
                    normalizedVersion: '0000000001.0000000000',
                    path: path.normalize('bucket1/artifact1-1.0-undefined-all-all-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[1].updatedAt,
                    createdAt: result.body[1].createdAt,
                    uploads: result.body[1].uploads,
                    downloads: result.body[1].downloads,
                    metadata: { arch: 'all', os: 'all', language: 'all', country: 'all', customVersion: 'none' }
                });
        });

        // get bucket1/artifact1/oldest -> [ bucket1/artifact1/1.0, bucket1/artifact1/2.0 ]
        step('should get the oldest artifacts 1 using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/artifacts/search?bucket=bucket1&artifact=artifact1&version=oldest')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/json')
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('array').and.to.have.lengthOf(2);
            result.body[0].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact1',
                    version: '1.0',
                    normalizedVersion: '0000000001.0000000000',
                    path: path.normalize('bucket1/artifact1-1.0-undefined-all-all-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[0].updatedAt,
                    createdAt: result.body[0].createdAt,
                    uploads: result.body[0].uploads,
                    downloads: result.body[0].downloads,
                    metadata: { arch: 'all', os: 'all', language: 'all', country: 'all', customVersion: 'none' }
                });
            result.body[1].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact1',
                    version: '2.0',
                    normalizedVersion: '0000000002.0000000000',
                    path: path.normalize('bucket1/artifact1-2.0-undefined-all-all-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[1].updatedAt,
                    createdAt: result.body[1].createdAt,
                    uploads: result.body[1].uploads,
                    downloads: result.body[1].downloads,
                    metadata: { arch: 'all', os: 'all', language: 'all', country: 'all', customVersion: 'none' }
                });
        });

        // get bucket1/artifact1/1.0 -> [ bucket1/artifact1/1.0 ]
        step('should get the artifacts 1 with version 1.0 using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/artifacts/search?bucket=bucket1&artifact=artifact1&version=1.0')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/json')
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('array').and.to.have.lengthOf(1);
            result.body[0].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact1',
                    version: '1.0',
                    normalizedVersion: '0000000001.0000000000',
                    path: path.normalize('bucket1/artifact1-1.0-undefined-all-all-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[0].updatedAt,
                    createdAt: result.body[0].createdAt,
                    uploads: result.body[0].uploads,
                    downloads: result.body[0].downloads,
                    metadata: { arch: 'all', os: 'all', language: 'all', country: 'all', customVersion: 'none' }
                });
        });

        // get bucket1/artifact1/2.0 -> [ bucket1/artifact1/2.0 ]
        step('should get the artifacts 1 with version 2.0 using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/artifacts/search?bucket=bucket1&artifact=artifact1&version=2.0')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/json')
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('array').and.to.have.lengthOf(1);
            result.body[0].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact1',
                    version: '2.0',
                    normalizedVersion: '0000000002.0000000000',
                    path: path.normalize('bucket1/artifact1-2.0-undefined-all-all-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[0].updatedAt,
                    createdAt: result.body[0].createdAt,
                    uploads: result.body[0].uploads,
                    downloads: result.body[0].downloads,
                    metadata: { arch: 'all', os: 'all', language: 'all', country: 'all', customVersion: 'none' }
                });
        });

        // get bucket1/artifact1/3.0 -> []
        step('should not get artifacts 1 with version 3.0 using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/artifacts/search?bucket=bucket1&artifact=artifact1&version=3.0')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/json')
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('array').and.to.have.lengthOf(0);
        });

        // get bucket1/artifact1/1.0?arch=x2 -> Error 400
        step('should not get artifact 1 using invalid metadata using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/artifacts/search?bucket=bucket1&artifact=artifact1&version=1.0&arch=x2')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/json')
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('array').and.to.have.lengthOf(0);
        });

        // get bucket1/artifact3/1.0 -> [ bucket1/artifact3/1.0?os=linux&arch=all, bucket1/artifact3/1.0?os=linux&arch=x86, bucket1/artifact3/1.0?os=x86&arch=all, bucket1/artifact3/1.0?os=macos&arch=x86 ]
        step('should get the artifacts 3 with version 1.0 using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/artifacts/search?bucket=bucket1&artifact=artifact3&version=1.0')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/json')
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('array').and.to.have.lengthOf(4);
            result.body[0].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact3',
                    version: '1.0',
                    normalizedVersion: '0000000001.0000000000',
                    path: path.normalize('bucket1/artifact3-1.0-undefined-linux-all-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[0].updatedAt,
                    createdAt: result.body[0].createdAt,
                    uploads: result.body[0].uploads,
                    downloads: result.body[0].downloads,
                    metadata: { arch: 'all', os: 'linux', language: 'all', country: 'all', customVersion: 'none' }
                });
            result.body[1].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact3',
                    version: '1.0',
                    normalizedVersion: '0000000001.0000000000',
                    path: path.normalize('bucket1/artifact3-1.0-undefined-linux-x86-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[1].updatedAt,
                    createdAt: result.body[1].createdAt,
                    uploads: result.body[1].uploads,
                    downloads: result.body[1].downloads,
                    metadata: { arch: 'x86', os: 'linux', language: 'all', country: 'all', customVersion: 'none' }
                });
            result.body[2].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact3',
                    version: '1.0',
                    normalizedVersion: '0000000001.0000000000',
                    path: path.normalize('bucket1/artifact3-1.0-undefined-macos-all-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[2].updatedAt,
                    createdAt: result.body[2].createdAt,
                    uploads: result.body[2].uploads,
                    downloads: result.body[2].downloads,
                    metadata: { arch: 'all', os: 'macos', language: 'all', country: 'all', customVersion: 'none' }
                });
            result.body[3].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact3',
                    version: '1.0',
                    normalizedVersion: '0000000001.0000000000',
                    path: path.normalize('bucket1/artifact3-1.0-undefined-windows-x86-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[3].updatedAt,
                    createdAt: result.body[3].createdAt,
                    uploads: result.body[3].uploads,
                    downloads: result.body[3].downloads,
                    metadata: { arch: 'x86', os: 'windows', language: 'all', country: 'all', customVersion: 'none' }
                });
        });

        // get bucket1/artifact3/1.0?os=linux -> [ bucket1/artifact3/1.0?os=linux&arch=all, bucket1/artifact3/1.0?os=linux&arch=x86 ]
        step('should get the artifacts 3 with version 1.0 and metadata os=linux using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/artifacts/search?bucket=bucket1&artifact=artifact3&version=1.0&os=linux')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/json')
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('array').and.to.have.lengthOf(2);
            result.body[0].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact3',
                    version: '1.0',
                    normalizedVersion: '0000000001.0000000000',
                    path: path.normalize('bucket1/artifact3-1.0-undefined-linux-all-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[0].updatedAt,
                    createdAt: result.body[0].createdAt,
                    uploads: result.body[0].uploads,
                    downloads: result.body[0].downloads,
                    metadata: { arch: 'all', os: 'linux', language: 'all', country: 'all', customVersion: 'none' }
                });
            result.body[1].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact3',
                    version: '1.0',
                    normalizedVersion: '0000000001.0000000000',
                    path: path.normalize('bucket1/artifact3-1.0-undefined-linux-x86-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[1].updatedAt,
                    createdAt: result.body[1].createdAt,
                    uploads: result.body[1].uploads,
                    downloads: result.body[1].downloads,
                    metadata: { arch: 'x86', os: 'linux', language: 'all', country: 'all', customVersion: 'none' }
                });
        });

        // get bucket1/artifact3/1.0?os=linux&arch=x86 -> [ bucket1/artifact3/1.0?os=linux&arch=x86 ]
        step('should get the artifacts 3 with version 1.0 and metadata os=linux and arch=x86 using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/artifacts/search?bucket=bucket1&artifact=artifact3&version=1.0&os=linux&arch=x86')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/json')
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('array').and.to.have.lengthOf(1);
            result.body[0].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact3',
                    version: '1.0',
                    normalizedVersion: '0000000001.0000000000',
                    path: path.normalize('bucket1/artifact3-1.0-undefined-linux-x86-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[0].updatedAt,
                    createdAt: result.body[0].createdAt,
                    uploads: result.body[0].uploads,
                    downloads: result.body[0].downloads,
                    metadata: { arch: 'x86', os: 'linux', language: 'all', country: 'all', customVersion: 'none' }
                });
        });

        // get bucket1/artifact3/1.0?os=macos -> [ bucket1/artifact3/1.0?os=macos&arch=all ]
        step('should get the artifacts 3 with version 1.0 and metadata os=macos using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/artifacts/search?bucket=bucket1&artifact=artifact3&version=1.0&os=macos')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/json')
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('array').and.to.have.lengthOf(1);
            result.body[0].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact3',
                    version: '1.0',
                    normalizedVersion: '0000000001.0000000000',
                    path: path.normalize('bucket1/artifact3-1.0-undefined-macos-all-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[0].updatedAt,
                    createdAt: result.body[0].createdAt,
                    uploads: result.body[0].uploads,
                    downloads: result.body[0].downloads,
                    metadata: { arch: 'all', os: 'macos', language: 'all', country: 'all', customVersion: 'none' }
                });
        });

        // get bucket1/artifact3/1.0?os=macos&arch=all -> [ bucket1/artifact3/1.0?os=macos&arch=all ]
        step('should get the artifacts 3 with version 1.0 and metadata os=macos and arch=all using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/artifacts/search?bucket=bucket1&artifact=artifact3&version=1.0&os=macos&arch=all')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/json')
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('array').and.to.have.lengthOf(1);
            result.body[0].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact3',
                    version: '1.0',
                    normalizedVersion: '0000000001.0000000000',
                    path: path.normalize('bucket1/artifact3-1.0-undefined-macos-all-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[0].updatedAt,
                    createdAt: result.body[0].createdAt,
                    uploads: result.body[0].uploads,
                    downloads: result.body[0].downloads,
                    metadata: { arch: 'all', os: 'macos', language: 'all', country: 'all', customVersion: 'none' }
                });
        });

        // get bucket1/artifact3/1.0?os=latest -> [ bucket1/artifact3/1.0?os=linux&arch=all, bucket1/artifact3/1.0?os=linux&arch=x86, bucket1/artifact3/1.0?os=x86&arch=all, bucket1/artifact3/1.0?os=macos&arch=x86 ]
        step('should get the artifacts 3 with version 1.0 and metadata os=latest using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/artifacts/search?bucket=bucket1&artifact=artifact3&version=1.0&os=latest')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/json')
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('array').and.to.have.lengthOf(4);
            result.body[0].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact3',
                    version: '1.0',
                    normalizedVersion: '0000000001.0000000000',
                    path: path.normalize('bucket1/artifact3-1.0-undefined-windows-x86-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[0].updatedAt,
                    createdAt: result.body[0].createdAt,
                    uploads: result.body[0].uploads,
                    downloads: result.body[0].downloads,
                    metadata: { arch: 'x86', os: 'windows', language: 'all', country: 'all', customVersion: 'none' }
                });
            result.body[1].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact3',
                    version: '1.0',
                    normalizedVersion: '0000000001.0000000000',
                    path: path.normalize('bucket1/artifact3-1.0-undefined-macos-all-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[1].updatedAt,
                    createdAt: result.body[1].createdAt,
                    uploads: result.body[1].uploads,
                    downloads: result.body[1].downloads,
                    metadata: { arch: 'all', os: 'macos', language: 'all', country: 'all', customVersion: 'none' }
                });
            result.body[2].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact3',
                    version: '1.0',
                    normalizedVersion: '0000000001.0000000000',
                    path: path.normalize('bucket1/artifact3-1.0-undefined-linux-all-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[2].updatedAt,
                    createdAt: result.body[2].createdAt,
                    uploads: result.body[2].uploads,
                    downloads: result.body[2].downloads,
                    metadata: { arch: 'all', os: 'linux', language: 'all', country: 'all', customVersion: 'none' }
                });
            result.body[3].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact3',
                    version: '1.0',
                    normalizedVersion: '0000000001.0000000000',
                    path: path.normalize('bucket1/artifact3-1.0-undefined-linux-x86-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[3].updatedAt,
                    createdAt: result.body[3].createdAt,
                    uploads: result.body[3].uploads,
                    downloads: result.body[3].downloads,
                    metadata: { arch: 'x86', os: 'linux', language: 'all', country: 'all', customVersion: 'none' }
                });

        });

        // get bucket1/artifact3/1.0?os=windows -> [ bucket1/artifact3/1.0?os=windows&arch=x86 ]
        step('should get the artifacts 3 with version 1.0 and metadata os=windows and arch=x86 using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/artifacts/search?bucket=bucket1&artifact=artifact3&version=1.0&os=windows')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/json')
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('array').and.to.have.lengthOf(1);
            result.body[0].should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact3',
                    version: '1.0',
                    normalizedVersion: '0000000001.0000000000',
                    path: path.normalize('bucket1/artifact3-1.0-undefined-windows-x86-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: result.body[0].updatedAt,
                    createdAt: result.body[0].createdAt,
                    uploads: result.body[0].uploads,
                    downloads: result.body[0].downloads,
                    metadata: { arch: 'x86', os: 'windows', language: 'all', country: 'all', customVersion: 'none' }
                });
        });

        // get bucket1/artifact3/1.0?os=all -> []
        step('should not get the artifacts 3 with os=all using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/artifacts/search?bucket=bucket1&artifact=artifact1&version=3.0')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/json')
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('array').and.to.have.lengthOf(0);
        });

        // get bucket1/artifacts -> [6]
        step('should get all artifacts from bucket1 using user 1', async () => {
            const result = await supertest(context.server.app)
                .get('/api/artifacts/search?bucket=bucket1')
                .set({ Authorization: context.tokenUserUser1 })
                .accept('application/json')
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('array').and.to.have.lengthOf(6);
        });
    });

    describe('delete /api/buckets/:bucketName/artifacts/:artifactName/:version? using user 1', async () => {
        // delete bucket1/artifact1/1.0 -> bucket1/artifact1/1.0
        step('should delete artifacts 1 version 1.0 using user 1', async () => {
            const deleteResult = await supertest(context.server.app)
                .delete('/api/buckets/bucket1/artifacts/artifact1/1.0')
                .set({ Authorization: context.tokenUserUser1 })
                .expect(200);
            should.exist(deleteResult.body);
            deleteResult.body.should.be.an('object');
            deleteResult.body.should.be.deep.equal(
                {
                    bucket: 'bucket1',
                    name: 'artifact1',
                    version: '1.0',
                    normalizedVersion: '0000000001.0000000000',
                    path: path.normalize('bucket1/artifact1-1.0-undefined-all-all-all-all-none.zip'),
                    fileSize: 561,
                    updatedAt: deleteResult.body.updatedAt,
                    createdAt: deleteResult.body.createdAt,
                    uploads: deleteResult.body.uploads,
                    downloads: deleteResult.body.downloads,
                    metadata: { arch: 'all', os: 'all', language: 'all', country: 'all', customVersion: 'none' }
                });

            const getResult = await supertest(context.server.app)
                .get('/api/artifacts/search?bucket=bucket1&artifact=artifact1')
                .accept('application/json')
                .expect(200);
            should.exist(getResult.body);
            getResult.body.should.be.an('array').and.to.have.lengthOf(1);
        });
    });

    describe('post /api/webhook', async () => {
        step('should post a webhook', async () => {
            const webhookCreationResult = await supertest(context.server.app)
                .post('/api/webhooks')
                .send({
                    bucket: 'bucket1',
                    artifact: 'artifact5',
                    endpoint: 'http://localhost:5673/webhook'
                })
                .expect(200);
            should.exist(webhookCreationResult.body);
            webhookCreationResult.body.should.be.an('object');
            webhookCreationResult.body.bucket.should.not.be.empty;
        });
    });

    describe('post /api/tokens/grants', async () => {
        step('should create a grant token for user granted 1 using user 1', async () => {
            const tokenResponse = await supertest(context.server.app)
                .post('/api/tokens/grants')
                .set({ Authorization: context.tokenUserUser1 })
                .send({
                    username: 'Granted1',
                    grants: {
                        buckets: ['bucket1'],
                        artifactsCreate: true,
                        artifactUpdate: true,
                        artifactRemove: true
                    }
                })
                .expect(200);
            context.tokenUserGranted1 = tokenResponse.body.token;
        });

        // put bucket1/artifact1/1.0 using granted 1 on bucket 1 -> bucket1/artifact1/1.0
        step('should create an artifact with version 1.0 using granted 1 on bucket 1', async () => {
            const result = await supertest(context.server.app)
                .put('/api/buckets/bucket1/artifacts/artifact6/1.0')
                .set({ Authorization: context.tokenUserGranted1 })
                .attach('artifact', path.resolve(__dirname, 'file.zip'))
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('object');
            result.body.version.should.be.an('string').equal('1.0');
            context.updatedAt = result.body.updatedAt;
        });

        // put bucket1/artifact1/1.0 using granted 1 on bucket 2 -> 403
        step('should not create an artifact with version 1.0 using granted 1 on bucket 2', async () => {
            return await supertest(context.server.app)
                .put('/api/buckets/bucket2/artifacts/artifact1/1.0')
                .set({ Authorization: context.tokenUserGranted1 })
                .attach('artifact', path.resolve(__dirname, 'file.zip'))
                .expect(403);
        });

        // put bucket1/artifact1/1.0 using granted 1 on bucket 1 -> bucket1/artifact1/1.0
        step('should remove artifact6 using granted 1 on bucket 1', async () => {
            return await supertest(context.server.app)
                .delete('/api/buckets/bucket1/artifacts/artifact6/1.0')
                .set({ Authorization: context.tokenUserGranted1 })
                .expect(200);
        });
    });
    
    describe('features', async () => {
        // put bucket1/artifact4/{empty} -> bucket1/artifact4/{now}
        step('should create the artifact 4 with the default version (version=now) using user 1', async () => {
            const result = await supertest(context.server.app)
                .put('/api/buckets/bucket1/artifacts/artifact4')
                .set({ Authorization: context.initialToken })
                .attach('artifact', path.resolve(__dirname, 'file.zip'))
                .expect(200);
            should.exist(result.body);
            result.body.should.be.an('object');
            result.body.version.should.not.be.empty;
        });

        // put [/buckets/bucket1/artifacts/artifact5, /buckets/bucket1/artifacts/artifact6] -> Call 1 webhook
        step('should call the webhook when posting the correct artifact using user 1', async () => {
            let called = 0;

            Webhook.__set__('webhookCaller', () => called++);

            await timeout(3000);

            await supertest(context.server.app)
                .put('/api/buckets/bucket1/artifacts/artifact5')
                .set({ Authorization: context.initialToken })
                .attach('artifact', path.resolve(__dirname, 'file.zip'))
                .expect(200);

            await supertest(context.server.app)
                .put('/api/buckets/bucket1/artifacts/artifact6')
                .set({ Authorization: context.initialToken })
                .attach('artifact', path.resolve(__dirname, 'file.zip'))
                .expect(200);

            called.should.be.equal(1);
        });
    });
});