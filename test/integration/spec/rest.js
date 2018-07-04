'use strict';

const assert = require('assert');

const {
  enableRestApiTests
} = require('../../env');

const defaults = require('../../lib/defaults');
const getToken = require('../../lib/token');

const {
  randomName,
  participantsConnected,
  smallVideoConstraints,
  tracksSubscribed
} = require('../../lib/util');

const {
  completeRoom,
  createRoom,
  subscribeTrack,
  unsubscribeTrack
} = require('../../lib/rest');

const connect = require('../../../lib/connect');
const { RoomMaxParticipantsExceededError } = require('../../../lib/util/twilio-video-errors');

// NOTE(mmalavalli): A dummy describe() block is declared to prevent
// mocha from erroring out due to all tests being skipped when
// ENABLE_REST_API_TESTS is not present in process.env.
describe('', () => {
  it('', () => {});
});

(enableRestApiTests ? describe : describe.skip)('REST APIs', function() {
  // eslint-disable-next-line no-invalid-this
  this.timeout(60000);

  describe('Small Group Room', () => {
    let name;

    before(async () => {
      name = randomName();
      await createRoom(name, 'group-small');
      const options = Object.assign({ name, tracks: [] }, defaults);
      await Promise.all([1, 2, 3, 4].map(randomName).map(getToken).map(token => connect(token, options)));
    });

    context('when a fifth Participant tries to connect to a Small Group Room', () => {
      let error;

      before(async () => {
        try {
          const options = Object.assign({ name, tracks: [] }, defaults);
          await connect(getToken(randomName()), options);
        } catch (e) {
          error = e;
        }
      });

      it('should reject with a RoomMaxParticipantsExceededError', () => {
        assert(error instanceof RoomMaxParticipantsExceededError);
      });
    });

    after(() => {
      return completeRoom(name);
    });
  });

  describe('Track Subscription', () => {
    let rooms;

    before(async () => {
      const options = Object.assign({ audio: true, name: randomName(), video: smallVideoConstraints }, defaults);
      const tokens = [1, 2].map(randomName).map(getToken);
      rooms = await Promise.all(tokens.map(token => connect(token, options)));
      await Promise.all(rooms.map(room => participantsConnected(room, 1)));
      await Promise.all(rooms.map(({ participants }) => [...participants.values()][0]).map(participant => tracksSubscribed(participant, 2)));
    });

    ['subscribe', 'unsubscribe'].forEach(trackAction => {
      const event = { subscribe: 'trackSubscribed', unsubscribe: 'trackUnsubscribed' }[trackAction];
      const subscribesToOrUnsubscribesFrom = { subscribe: 'subscribes to', unsubscribe: 'unsubscribes from' }[trackAction];

      context(`when a Participant ${subscribesToOrUnsubscribesFrom} a RemoteTrack of another RemoteParticipant`, () => {
        let originalTrack;
        let participant;
        let publication;
        let room;
        let subscribedOrUnsubscribedTrack;
        let trackSubscribedOrUnsubscribed;

        before(async () => {
          room = rooms[1];
          participant = [...room.participants.values()][0];
          publication = [...participant.videoTrackPublications.values()][0];
          originalTrack = publication.track;

          trackSubscribedOrUnsubscribed = new Promise(resolve => participant.once(event, resolve));
          await unsubscribeTrack(publication, room);

          if (trackAction === 'subscribe') {
            await subscribeTrack(publication, room);
          }
          subscribedOrUnsubscribedTrack = await trackSubscribedOrUnsubscribed;
        });

        it(`should emit "${event}" on the RemoteParticipant`, () => {
          if (trackAction === 'unsubscribe') {
            assert.equal(publication.track, null);
          }
          const subsequentTrack = publication.track;
          const { id, kind } = originalTrack;
          const { trackSid } = publication;

          assert.equal(subscribedOrUnsubscribedTrack, trackAction === 'subscribe' ? subsequentTrack : originalTrack);
          assert.equal(participant.tracks.has(id), trackAction === 'subscribe');
          assert.equal(participant[`${kind}Tracks`].has(id), trackAction === 'subscribe');
          assert(participant.trackPublications.has(trackSid));
          assert(participant[`${kind}TrackPublications`].has(trackSid));
        });
      });
    });

    after(() => {
      if (Array.isArray(rooms)) {
        rooms.forEach(room => room.disconnect());
      }
      rooms = null;
    });
  });
});
