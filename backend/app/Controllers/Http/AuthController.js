'use strict';
const { validate } = use('Validator');
const Encryption = use('Encryption');
const User = use('App/Models/User');
const Token = use('App/Models/Token');
const BusinessNetworkConnection = require('composer-client').BusinessNetworkConnection;
const AdminConnection = require('composer-admin').AdminConnection;
const { BusinessNetworkDefinition, CertificateUtil, IdCard } = require('composer-common');

class AuthController {
  async signIn({ request, response, auth }) {
    const rules = {
      email: 'required|email',
      password: 'required'
    };

    const { email, password } = request.only(['email', 'password']);

    const validation = await validate({ email, password }, rules);

    if (!validation.fails()) {
      try {
        return await auth.withRefreshToken().attempt(email, password);
      } catch (err) {
        response.status(401).send({ error: 'Invalid email or password' });
      }
    } else {
      response.status(401).send(validation.messages());
    }
  }

  async register({ request, response }) {
    const rules = {
      email: 'required|email|unique:users,email',
      username: 'required|unique:users,username',
      password: 'required'
    };

    const { email, username, password } = request.only([
      'email',
      'username',
      'password'
    ]);

    const validation = await validate({ email, username, password }, rules);

    if (!validation.fails()) {
      try {
        const user = await User.create({ email, username, password });


        let businessNetworkConnection = new BusinessNetworkConnection();
        await businessNetworkConnection.connect('admin@mixchain-network');

        //get the factory for the business network
        let factory = businessNetworkConnection.getBusinessNetwork().getFactory();

        //create member participant
        let namespace = 'com.mixchain';
        const member = factory.newResource(namespace, 'Member', '' + user.id);
        member.firstName = user.username;
        member.lastName = user.username;
        member.email = user.email;
        member.phoneNumber = '';
        member.points = 0;

        //add member participant
        const participantRegistry = await businessNetworkConnection.getParticipantRegistry(namespace + '.Member');
        await participantRegistry.add(member);

        //issue identity
        const identity = await businessNetworkConnection.issueIdentity(namespace + '.Member#' + user.id, '' + user.id);

        //import card for identity
        await this.importCardForIdentity('' + user.id, identity);

        //disconnect
        await businessNetworkConnection.disconnect('admin@mixchain-network');

        return response.send({ message: 'User has been created' });
      } catch (err) {
        console.log(err);
        response.status(401).send({ error: 'Please try again' });
      }
    } else {
      response.status(401).send(validation.messages());
    }
  }

  async importCardForIdentity(cardName, identity) {

    //use admin connection
    let adminConnection = new AdminConnection();
    let businessNetworkName = 'mixchain-network';

    //declare metadata
    const metadata = {
      userName: identity.userID,
      version: 1,
      enrollmentSecret: identity.userSecret,
      businessNetwork: businessNetworkName
    };

    //get connectionProfile from json, create Idcard
    const connectionProfile = require('../../Networks/local_connection.json');
    const card = new IdCard(metadata, connectionProfile);

    //import card
    await adminConnection.importCard(cardName, card);
  }

  async refreshToken({ request, response, auth }) {
    const rules = {
      refresh_token: 'required'
    };

    const { refresh_token } = request.only(['refresh_token']);

    const validation = await validate({ refresh_token }, rules);

    if (!validation.fails()) {
      try {
        return await auth
          .newRefreshToken()
          .generateForRefreshToken(refresh_token);
      } catch (err) {
        response.status(401).send({ error: 'Invalid refresh token' });
      }
    } else {
      response.status(401).send(validation.messages());
    }
  }

  async logout({ request, response, auth }) {
    const rules = {
      refresh_token: 'required'
    };

    const { refresh_token } = request.only(['refresh_token']);

    const validation = await validate({ refresh_token }, rules);

    const decrypted = Encryption.decrypt(refresh_token);

    if (!validation.fails()) {
      try {
        const refreshToken = await Token.findBy('token', decrypted);
        if (refreshToken) {
          refreshToken.delete();
          response.status(200).send({ status: 'ok' });
        } else {
          response.status(401).send({ error: 'Invalid refresh token' });
        }
      } catch (err) {
        response.status(401).send({ error: 'something went wrong' });
      }
    } else {
      response.status(401).send(validation.messages());
    }
  }
}

module.exports = AuthController;
