/* global describe:true, it:true, before:true, beforeEach:true, afterEach:true */
import assert from 'assert';
import { contains } from 'lodash';
import { setupTestRekapi, setupTestActor } from './test-utils';

import Rekapi, { Actor } from '../src/main';
import {
  Tweenable,
  interpolate,
  setBezierFunction,
  unsetBezierFunction
} from 'shifty';

describe('Actor', () => {
  let rekapi, actor;

  beforeEach(() => {
    rekapi = setupTestRekapi();
    actor = setupTestActor(rekapi);
  });

  describe('constructor', () => {
    it('is a function', () => {
      assert.equal(typeof Actor, 'function');
    });
  });

  describe('#_updateState', () => {
    describe('interpolating positions', () => {
      describe('actors that start at 0', () => {
        it('interpolates actor positions at arbitrary positions mid-frame', () => {
          actor.keyframe(0, {
            x: 0,
            y: 0
          }).keyframe(1000, {
            x: 100,
            y:100
          });

          actor._updateState(0);
          assert.equal(actor.get().x, 0);
          assert.equal(actor.get().y, 0);

          actor._updateState(500);
          assert.equal(actor.get().x, 50);
          assert.equal(actor.get().y, 50);

          actor._updateState(1000);
          assert.equal(actor.get().x, 100);
          assert.equal(actor.get().y, 100);
        });
      });

      describe('actors that start later than 0', () => {
        it('interpolates actor positions at arbitrary positions mid-frame', () => {
          actor.keyframe(1000, {
            x: 0,
            y: 0
          }).keyframe(2000, {
            x: 100,
            y: 100
          });

          actor._updateState(1000);
          assert.equal(actor.get().x, 0);
          assert.equal(actor.get().y, 0);

          actor._updateState(1500);

          assert.equal(actor.get().x, 50);
          assert.equal(actor.get().y, 50,
            'Value "y" was properly interpolated at position 0.5');

          actor._updateState(2000);
          assert.equal(actor.get().x, 100);
          assert.equal(actor.get().y, 100);
        });

        describe('property look-ahead', () => {
          describe('single track', () => {
            it('looks ahead to first keyframe when computing states prior to actor start', () => {
              actor.keyframe(0, {
                // Nothing!
              }).keyframe(1000, {
                y: 100
              });

              actor._updateState(500);
              assert.equal(actor.get().y, 100);
            });
          });

          describe('multiple tracks', () => {
            it('looks ahead to first keyframe when computing states prior to actor start', () => {
              actor.keyframe(0, {
                x: 50
              }).keyframe(1000, {
                y: 100
              });

              actor._updateState(500);
              assert.equal(actor.get().y, 100);
            });
          });
        });
      });
    });

    describe('computing state past a keyframe track end', () => {
      it('leaves keyframe tracks at their final position', () => {
        actor.keyframe(0,{
          x: 100
        }).keyframe(1000, {
          y: 200
        });

        actor._updateState(500);
        assert.equal(actor.get().x, 100);
      });
    });

    describe('applying easing curves', () => {
      it('easing is taken from the destination frame', () => {
        let tweenableComparator;

        actor
          .keyframe(0, { x: 0 }, 'linear')
          .keyframe(1000, { x: 100 }, 'easeInSine')
          .keyframe(2000, { x: 200 }, 'easeOutCirc');

        tweenableComparator =
          interpolate({ x: 0 }, { x: 100 }, 0.5, 'easeInSine');

        actor._updateState(500);
        assert.equal(actor.get().x, tweenableComparator.x);

        tweenableComparator =
          interpolate({ x: 100 }, { x: 200 }, 0.5, 'easeOutCirc');

        actor._updateState(1500);
        assert.equal(actor.get().x, tweenableComparator.x);
      });
    });

    describe('#wasActive management', () => {
      it('updates wasActive for arbitrary state updates', () => {
        actor
          .keyframe(0,{ x: 0 })
          .setActive(250, false)
          .setActive(750, true)
          .keyframe(1000, { x: 100 });

        actor._updateState(100);
        assert(actor.wasActive);
        assert.equal(actor.get().x, 10);

        actor._updateState(500);
        assert.equal(actor.wasActive, false);
        assert.equal(actor.get().x, 10);

        actor._updateState(900);
        assert.ok(actor.wasActive);
        assert.equal(actor.get().x, 90);
      });
    });
  });
});
