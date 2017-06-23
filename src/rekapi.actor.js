import _, { noop } from 'lodash';
import { Tweenable } from 'shifty';
import { composeEasingObject } from '../node_modules/shifty/src/tweenable';
import KeyframeProperty from './rekapi.keyframe-property';
import {
  fireEvent,
  invalidateAnimationLength,
  DEFAULT_EASING
} from './rekapi.core';

/*!
 * @param {Object} obj
 * @return {number} millisecond
 */
const getMillisecond = obj => obj.millisecond;

// TODO: Make this a prototype method
/*!
 * @param {Rekapi.Actor} actor
 * @param {string} event
 * @param {any=} data
 */
const fire = (actor, event, data) =>
  actor.rekapi && fireEvent(actor.rekapi, event, data);

/*!
 * Retrieves the most recent property cache entry for a given millisecond.
 * @param {Rekapi.Actor} actor
 * @param {number} millisecond
 * @return {Object|undefined} undefined if there is no property cache for
 * the millisecond, i.e. an empty cache.
 */
const getPropertyCacheEntryForMillisecond = (actor, millisecond) => {
  const cache = actor._timelinePropertyCache;
  const index = _.sortedIndex(cache, { _millisecond: millisecond }, obj => obj._millisecond);

  return cache[index] && cache[index]._millisecond === millisecond ?
    cache[index] :
      index >= 1 ?
        cache[index - 1] :
        cache[0];
};

/*!
 * Search property track `track` and find the correct index to insert a
 * new element at `millisecond`.
 * @param {Array(Rekapi.KeyframeProperty)} track
 * @param {number} millisecond
 * @return {number} index
 */
const insertionPointInTrack = (track, millisecond) =>
  _.sortedIndex(track, { millisecond }, getMillisecond);

/*!
 * Gets all of the current and most recent Rekapi.KeyframeProperties for a
 * given millisecond.
 * @param {Rekapi.Actor} actor
 * @param {number} forMillisecond
 * @return {Object} An Object containing Rekapi.KeyframeProperties
 */
const getLatestProperties = (actor, forMillisecond) => {
  const latestProperties = {};

  _.each(actor._propertyTracks, (propertyTrack, propertyName) => {
    const index = insertionPointInTrack(propertyTrack, forMillisecond);

    latestProperties[propertyName] =
      propertyTrack[index] && propertyTrack[index].millisecond === forMillisecond ?
        // Found forMillisecond exactly.
        propertyTrack[index] :
          index >= 1 ?
            // forMillisecond doesn't exist in the track and index is
            // where we'd need to insert it, therefore the previous
            // keyframe is the most recent one before forMillisecond.
            propertyTrack[index - 1] :
            // Return first property.  This is after forMillisecond.
            propertyTrack[0];
  });

  return latestProperties;
};

/*!
 * Search property track `track` and find the index to the element that is
 * at `millisecond`.  Returns `undefined` if not found.
 * @param {Array(Rekapi.KeyframeProperty)} track
 * @param {number} millisecond
 * @return {number} index or -1 if not present
 */
const propertyIndexInTrack = (track, millisecond) => {
  const index = insertionPointInTrack(track, millisecond);

  return track[index] && track[index].millisecond === millisecond ?
    index : -1;
};

/*!
 * Mark the cache of internal KeyframeProperty data as invalid.  The cache
 * will be rebuilt on the next call to ensurePropertyCacheValid.
 * @param {Rekapi.Actor}
 */
const invalidateCache = actor => actor._timelinePropertyCacheValid = false;

/*!
 * Empty out and rebuild the cache of internal KeyframeProperty data if it
 * has been marked as invalid.
 * @param {Rekapi.Actor}
 */
const ensurePropertyCacheValid = actor => {
  if (actor._timelinePropertyCacheValid) {
    return;
  }

  actor._timelinePropertyCache = [];
  actor._timelineFunctionCache = [];

  const { _timelinePropertyCache, _timelineFunctionCache } = actor;

  // Build the cache map
  const props = _.values(actor._keyframeProperties)
    .sort((a, b) => a.millisecond - b.millisecond);

  let curCacheEntry = getLatestProperties(actor, 0);

  curCacheEntry._millisecond = 0;
  _timelinePropertyCache.push(curCacheEntry);

  props.forEach(property => {
    if (property.millisecond !== curCacheEntry._millisecond) {
      curCacheEntry = _.clone(curCacheEntry);
      curCacheEntry._millisecond = property.millisecond;
      _timelinePropertyCache.push(curCacheEntry);
    }

    curCacheEntry[property.name] = property;

    if (property.name === 'function') {
      _timelineFunctionCache.push(property);
    }
  });

  actor._timelinePropertyCacheValid = true;
};

/*!
 * Remove any property tracks that are empty.
 *
 * @param {Rekapi.Actor} actor
 */
const removeEmptyPropertyTracks = actor => {
  const { _propertyTracks } = actor;

  Object.keys(_propertyTracks).forEach(trackName => {
    if (!_propertyTracks[trackName].length) {
      delete _propertyTracks[trackName];
      fire(actor, 'removeKeyframePropertyTrack', trackName);
    }
  });
};

/*!
 * Stably sort all of the property tracks of an actor
 * @param {Rekapi.Actor} actor
 */
const sortPropertyTracks = actor => {
  _.each(actor._propertyTracks, (propertyTrack, trackName) => {
    propertyTrack = _.sortBy(propertyTrack, 'millisecond');

    propertyTrack.forEach((keyframeProperty, i) =>
      keyframeProperty.linkToNext(propertyTrack[i + 1])
    );

    actor._propertyTracks[trackName] = propertyTrack;
  });
};

/*!
 * Updates internal Rekapi and Actor data after a KeyframeProperty
 * modification method is called.
 *
 * @param {Rekapi.Actor} actor
 */
const cleanupAfterKeyframeModification = actor => {
  sortPropertyTracks(actor);
  invalidateCache(actor);

  if (actor.rekapi) {
    invalidateAnimationLength(actor.rekapi);
  }

  fire(actor, 'timelineModified');
};

/**
 * An actor represents an individual component of an animation.  An animation
 * may have one or many actors.
 *
 * @class Rekapi.Actor
 * @param {Object=} config Valid properties:
 *   - __context__ (_Object|CanvasRenderingContext2D|HTMLElement_): The
 *   rendering context for this actor. If omitted, this Actor gets the parent
 *   `{{#crossLink "Rekapi"}}{{/crossLink}}` instance's `context` when it is
 *   added with `{{#crossLink "Rekapi/addActor:method"}}{{/crossLink}}`.
 *   - __setup__ (_Function_): A function that gets called when the actor is
 *     added to an animation with
 *     `{{#crossLink "Rekapi/addActor:method"}}{{/crossLink}}`.
 *   - __render__ (_Function(Object, Object)_): A function that gets called
 *   every time the actor's state is updated (once every frame). This
 *   function should do something meaningful with state of the actor (for
 *   example, visually rendering to the screen).  This function receives two
 *   parameters: The first is a reference to the actor's `context` and the
 *   second is an Object containing the current state properties.
 *   - __teardown__ (_Function_): A function that gets called when the actor
 *   is removed from an animation with
 *   `{{#crossLink "Rekapi/removeActor:method"}}{{/crossLink}}`.
 * @constructor
 */
// FIXME: Make this a proper ES6 class
export default class Actor extends Tweenable {

  constructor (config = {}) {
    super();

    Object.assign(this, {
      _propertyTracks: {},
      _timelinePropertyCache: [],
      _timelineFunctionCache: [],
      _timelinePropertyCacheValid: false,
      _keyframeProperties: {},
      id: _.uniqueId(),
      context: config.context, // This may be undefined
      setup: config.setup || noop,
      render: config.render || noop,
      teardown: config.teardown || noop,
      data: {},
      wasActive: true
    });
  }

  /**
   * Create a keyframe for the actor.  The animation timeline begins at `0`.
   * The timeline's length will automatically "grow" to accommodate new
   * keyframes as they are added.
   *
   * `state` should contain all of the properties that define this
   * keyframe's state.  These properties can be any value that can be tweened
   * by [Shifty](http://jeremyckahn.github.io/shifty/) (numbers,
   * RGB/hexadecimal color strings, and CSS property strings).  `state` can
   * also be a function, but this works differently (see "Function keyframes"
   * below).
   *
   * __Note:__ Internally, this creates `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}`s and places them on a "track."
   * These `{{#crossLink "Rekapi.KeyframeProperty"}}{{/crossLink}}`s are
   * managed for you by the `{{#crossLink "Rekapi.Actor"}}{{/crossLink}}` APIs.
   *
   * ## Keyframe inheritance
   *
   * Keyframes always inherit missing properties from the previous keyframe.
   * For example:
   *
   *     actor.keyframe(0, {
   *       'x': 100
   *     }).keyframe(1000, {
   *       // Implicitly specifies the `x: 100` from above
   *       'y': 50
   *     });
   *
   * Keyframe `1000` will have a `y` of `50`, and an `x` of `100`, because `x`
   * was inherited from keyframe `0`.
   *
   * ## Function keyframes
   *
   * Instead of providing an Object to be used to interpolate state values, you
   * can provide a function to be called at a specific point on the timeline.
   * This function does not need to return a value, as it does not get used to
   * render the actor state.  Function keyframes are called once per animation
   * loop and do not have any tweening relationship with one another.  This is
   * a primarily a mechanism for scheduling arbitrary code to be executed at
   * specific points in an animation.
   *
   *     // drift is the number of milliseconds that this function was executed
   *     // after the scheduled time.  There is typically some amount of delay
   *     // due to the nature of JavaScript timers.
   *     actor.keyframe(1000, function (drift) {
   *       console.log(this); // Logs the actor instance
   *     });
   *
   * ## Easing
   *
   * `opt_easing`, if provided, can be a string or an Object.  If `opt_easing`
   * is a string, all animated properties will have the same easing curve
   * applied to them.  For example:
   *
   *     actor.keyframe(1000, {
   *         'x': 100,
   *         'y': 100
   *       }, 'easeOutSine');
   *
   * Both `x` and `y` will have `easeOutSine` applied to them.  You can also
   * specify multiple easing curves with an Object:
   *
   *     actor.keyframe(1000, {
   *         'x': 100,
   *         'y': 100
   *       }, {
   *         'x': 'easeinSine',
   *         'y': 'easeOutSine'
   *       });
   *
   * `x` will ease with `easeInSine`, and `y` will ease with `easeOutSine`.
   * Any unspecified properties will ease with `linear`.  If `opt_easing` is
   * omitted, all properties will default to `linear`.
   * @method keyframe
   * @param {number} millisecond Where on the timeline to set the keyframe.
   * @param {Object|Function(number)} state The state properties of the
   * keyframe.  If this is an Object, the properties will be interpolated
   * between this and those of the following keyframe for a given point on the
   * animation timeline.  If this is a function, it will be executed at the
   * specified keyframe.  The function will receive a number that represents
   * the delay between when the function is called and when it was scheduled.
   * @param {string|Object=} opt_easing Optional easing string or Object.  If
   * `state` is a function, this is ignored.
   * @chainable
   */
  keyframe (millisecond, state, opt_easing) {
    if (state instanceof Function) {
      state = { 'function': state };
    }

    opt_easing = opt_easing || DEFAULT_EASING;
    var easing = composeEasingObject(state, opt_easing);
    var newKeyframeProperty;

    // Create and add all of the KeyframeProperties
    _.each(state, function (value, name) {
      newKeyframeProperty = new KeyframeProperty(
        millisecond, name, value, easing[name]);

      this.addKeyframeProperty(newKeyframeProperty);
    }, this);

    if (this.rekapi) {
      invalidateAnimationLength(this.rekapi);
    }

    invalidateCache(this);
    fire(this, 'timelineModified');

    return this;
  }

  /**
   * @method hasKeyframeAt
   * @param {number} millisecond Point on the timeline to query.
   * @param {string=} opt_trackName Optionally scope the lookup to a particular
   * track.
   * @return {boolean} Whether or not the actor has any `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}`s set at `millisecond`.
   */
  hasKeyframeAt (millisecond, opt_trackName) {
    var tracks = this._propertyTracks;

    if (opt_trackName) {
      if (!_.has(tracks, opt_trackName)) {
        return false;
      }
      tracks = _.pick(tracks, opt_trackName);
    }

    // Search through the tracks and determine if a property can be found.
    var track;
    for (track in tracks) {
      if (tracks.hasOwnProperty(track)
         && this.getKeyframeProperty(track, millisecond)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Copies all of the `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}`s from one point on the actor's
   * timeline to another. This is particularly useful for animating an actor
   * back to its original position.
   *
   *     actor
   *       .keyframe(0, {
   *         x: 10,
   *         y: 15
   *       }).keyframe(1000, {
   *         x: 50,
   *         y: 75
   *       });
   *
   *     // Return the actor to its original position
   *     actor.copyKeyframe(2000, 0);
   *
   * __[Example](../../../../examples/actor_copy_keyframe.html)__
   * @method copyKeyframe
   * @param {number} copyTo The timeline millisecond to copy KeyframeProperties
   * to.
   * @param {number} copyFrom The timeline millisecond to copy
   * KeyframeProperties from.
   * @chainable
   */
  copyKeyframe (copyTo, copyFrom) {
    // Build the configuation objects to be passed to Actor#keyframe
    var sourcePositions = {};
    var sourceEasings = {};

    _.each(this._propertyTracks, function (propertyTrack, trackName) {
      var keyframeProperty =
      this.getKeyframeProperty(trackName, copyFrom);

      if (keyframeProperty) {
        sourcePositions[trackName] = keyframeProperty.value;
        sourceEasings[trackName] = keyframeProperty.easing;
      }
    }, this);

    this.keyframe(copyTo, sourcePositions, sourceEasings);
    return this;
  }

  /**
   * Moves all of the
   * `{{#crossLink "Rekapi.KeyframeProperty"}}{{/crossLink}}`s from one
   * point on the actor's timeline to another.  Although this method does error
   * checking for you to make sure the operation can be safely performed, an
   * effective pattern is to use `{{#crossLink
   * "Rekapi.Actor/hasKeyframeAt:method"}}{{/crossLink}}` to see if there is
   * already a keyframe at the requested `to` destination.
   *
   * __[Example](../../../../examples/actor_move_keyframe.html)__
   * @method moveKeyframe
   * @param {number} from The millisecond of the keyframe to be moved.
   * @param {number} to The millisecond of where the keyframe should be moved
   * to.
   * @return {boolean} Whether or not the keyframe was successfully moved.
   */
  moveKeyframe (from, to) {
    if (!this.hasKeyframeAt(from) || this.hasKeyframeAt(to)) {
      return false;
    }

    // Move each of the relevant KeyframeProperties to the new location in the
    // timeline
    _.each(this._propertyTracks, function (propertyTrack, trackName) {
      var oldIndex = propertyIndexInTrack(propertyTrack, from);
      if (typeof oldIndex !== -1) {
        var property = propertyTrack[oldIndex];
        property.millisecond = to;
      }
    }, this);

    cleanupAfterKeyframeModification(this);

    return true;
  }

  /**
   * Augment the `value` or `easing` of the `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}`s at a given millisecond.  Any
   * `{{#crossLink "Rekapi.KeyframeProperty"}}{{/crossLink}}`s omitted in
   * `stateModification` or `opt_easing` are not modified.
   *
   *     actor.keyframe(0, {
   *       'x': 10,
   *       'y': 20
   *     }).keyframe(1000, {
   *       'x': 20,
   *       'y': 40
   *     }).keyframe(2000, {
   *       'x': 30,
   *       'y': 60
   *     })
   *
   *     // Changes the state of the keyframe at millisecond 1000.
   *     // Modifies the value of 'y' and the easing of 'x.'
   *     actor.modifyKeyframe(1000, {
   *       'y': 150
   *     }, {
   *       'x': 'easeFrom'
   *     });
   *
   * __[Example](../../../../examples/actor_modify_keyframe.html)__
   * @method modifyKeyframe
   * @param {number} millisecond
   * @param {Object} stateModification
   * @param {Object=} opt_easingModification
   * @chainable
   */
  modifyKeyframe (
    millisecond, stateModification, opt_easingModification) {
    opt_easingModification = opt_easingModification || {};

    _.each(this._propertyTracks, function (propertyTrack, trackName) {
      var property = this.getKeyframeProperty(trackName, millisecond);

      if (property) {
        property.modifyWith({
          'value': stateModification[trackName]
          ,'easing': opt_easingModification[trackName]
        });
      } else if (typeof stateModification[trackName] !== 'undefined') {
        property = new KeyframeProperty(
          millisecond, trackName,
          stateModification[trackName],
          opt_easingModification[trackName]);

        this.addKeyframeProperty(property);
      }
    }, this);

    cleanupAfterKeyframeModification(this);

    return this;
  }

  /**
   * Remove all `{{#crossLink "Rekapi.KeyframeProperty"}}{{/crossLink}}`s set
   * on the actor at a given millisecond in the animation.
   *
   * __[Example](../../../../examples/actor_remove_keyframe.html)__
   * @method removeKeyframe
   * @param {number} millisecond The location on the timeline of the keyframe
   * to remove.
   * @chainable
   */
  removeKeyframe (millisecond) {
    var propertyTracks = this._propertyTracks;

    _.each(this._propertyTracks, function (propertyTrack, propertyName) {
      var index = propertyIndexInTrack(propertyTrack, millisecond);
      if (typeof index !== -1) {
        var keyframeProperty = propertyTrack[index];
        this._deleteKeyframePropertyAt(propertyTrack, index);
        keyframeProperty.detach();
      }
    }, this);

    removeEmptyPropertyTracks(this);
    cleanupAfterKeyframeModification(this);
    fire(this, 'timelineModified');

    return this;
  }

  /**
   * Remove all `{{#crossLink "Rekapi.KeyframeProperty"}}{{/crossLink}}`s set
   * on the actor.
   *
   * **NOTE**: This method does _not_ fire the `beforeRemoveKeyframeProperty`
   * or `removeKeyframePropertyComplete` events.  This method is a bulk
   * operation that is more efficient than calling `{{#crossLink
   * "Rekapi.Actor/removeKeyframeProperty:method"}}{{/crossLink}}` many times
   * individually, but foregoes firing events.
   *
   * __[Example](../../../../examples/actor_remove_all_keyframes.html)__
   * @method removeAllKeyframes
   * @chainable
   */
  removeAllKeyframes () {
    _.each(this._propertyTracks, function (propertyTrack) {
      propertyTrack.length = 0;
    });

    _.each(this._keyframeProperties, function (keyframeProperty) {
      keyframeProperty.detach();
    }, this);

    removeEmptyPropertyTracks(this);
    this._keyframeProperties = {};

    // Calling removeKeyframe performs some necessary post-removal cleanup, the
    // earlier part of this method skipped all of that for the sake of
    // efficiency.
    return this.removeKeyframe(0);
  }

  /**
   * @method getKeyframeProperty
   * @param {string} property The name of the property track.
   * @param {number} millisecond The millisecond of the property in the
   * timeline.
   * @return {Rekapi.KeyframeProperty|undefined} A `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}` that is stored on the actor, as
   * specified by the `property` and `millisecond` parameters. This is
   * `undefined` if no properties were found.
   */
  getKeyframeProperty (property, millisecond) {
    var propertyTrack = this._propertyTracks[property];
    var index = propertyIndexInTrack(propertyTrack, millisecond);
    if (typeof index !== -1) {
      return propertyTrack[index];
    }
  }

  /**
   * Modify a `{{#crossLink "Rekapi.KeyframeProperty"}}{{/crossLink}}` stored
   * on an actor.  Internally, this calls `{{#crossLink
   * "Rekapi.KeyframeProperty/modifyWith:method"}}{{/crossLink}}` and then
   * performs some cleanup.
   *
   * __[Example](../../../../examples/actor_modify_keyframe_property.html)__
   * @method modifyKeyframeProperty
   * @param {string} property The name of the `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}` to modify.
   * @param {number} millisecond The timeline millisecond of the `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}` to modify.
   * @param {Object} newProperties The properties to augment the `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}` with.
   * @chainable
   */
  modifyKeyframeProperty (
    property, millisecond, newProperties) {

    var keyframeProperty = this.getKeyframeProperty(property, millisecond);
    if (keyframeProperty) {
      if ('millisecond' in newProperties) {
        if (this.hasKeyframeAt(newProperties.millisecond, property)) {
          throw new Error('Tried to move ' + property + ' to ' + newProperties.millisecond + 'ms, but a keyframe property already exists there');
        }
      }

      keyframeProperty.modifyWith(newProperties);
      cleanupAfterKeyframeModification(this);
    }

    return this;
  }

  /**
   * Remove a single `{{#crossLink "Rekapi.KeyframeProperty"}}{{/crossLink}}`
   * from the actor.
   * @method removeKeyframeProperty
   * @param {string} property The name of the `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}` to remove.
   * @param {number} millisecond Where in the timeline the `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}` to remove is.
   * @return {Rekapi.KeyframeProperty|undefined} The removed KeyframeProperty,
   * if one was found.
   */
  removeKeyframeProperty (property, millisecond) {
    var propertyTracks = this._propertyTracks;

    if (typeof propertyTracks[property] !== 'undefined') {
      var propertyTrack = propertyTracks[property];
      var index = propertyIndexInTrack(propertyTrack, millisecond);
      var keyframeProperty = propertyTrack[index];
      fireEvent(this.rekapi, 'beforeRemoveKeyframeProperty', keyframeProperty);
      this._deleteKeyframePropertyAt(propertyTrack, index);
      keyframeProperty.detach();

      removeEmptyPropertyTracks(this);
      cleanupAfterKeyframeModification(this);
      fireEvent(this.rekapi, 'removeKeyframePropertyComplete', keyframeProperty);

      return keyframeProperty;
    }
  }

  /**
   *
   * @method getTrackNames
   * @return {Array(string)} A list of all the track names for an actor.
   */
  getTrackNames () {
    return _.keys(this._propertyTracks);
  }

  /**
   * Get all of the `{{#crossLink "Rekapi.KeyframeProperty"}}{{/crossLink}}`s
   * for a track.
   * @method getPropertiesInTrack
   * @param {string} trackName The track name to query.
   * @return {Rekapi.KeyframeProperty[]|undefined}
   */
  getPropertiesInTrack (trackName) {
    var propertyTrack = this._propertyTracks[trackName];

    if (propertyTrack) {
      return propertyTrack.slice(0);
    }
  }

  /**
   * @method getStart
   * @param {string=} opt_trackName Optionally scope the lookup to a particular
   * track.
   * @return {number} The millisecond of the first animating state of an actor
   * (for instance, if the actor's first keyframe is later than millisecond
   * `0`).  If there are no keyframes, this returns `0`.
   */
  getStart (opt_trackName) {
    var starts = [];
    var propertyTracks = this._propertyTracks;

    // Null check to see if opt_trackName was provided and is valid
    if (propertyTracks.hasOwnProperty(opt_trackName)) {
      var firstKeyframeProperty = propertyTracks[opt_trackName][0];

      if (firstKeyframeProperty) {
        starts.push(firstKeyframeProperty.millisecond);
      }
    } else {
      // Loop over all property tracks and accumulate the first
      // keyframeProperties from non-empty tracks
      _.each(propertyTracks, function (propertyTrack) {
        if (propertyTrack.length) {
          starts.push(propertyTrack[0].millisecond);
        }
      });
    }

    if (starts.length === 0) {
      starts = [0];
    }

    var start;
    if (starts.length > 0) {
      start = Math.min.apply(Math, starts);
    } else {
      start = 0;
    }

    return start;
  }

  /**
   * @method getEnd
   * @param {string=} opt_trackName Optionally scope the lookup to a particular
   * keyframe track.
   * @return {number} The millisecond of the last state of an actor (the point
   * in the timeline in which it is done animating).  If there are no
   * keyframes, this is `0`.
   */
  getEnd (opt_trackName) {
    var latest = 0;
    var tracksToInspect = this._propertyTracks;

    if (opt_trackName) {
      tracksToInspect = {};
      tracksToInspect[opt_trackName] = this._propertyTracks[opt_trackName];
    }

    _.each(tracksToInspect, function (propertyTrack) {
      if (propertyTrack.length) {
        var trackLength = Math.max.apply(Math, _.map(propertyTrack, 'millisecond'));

        if (trackLength > latest) {
          latest = trackLength;
        }
      }
    }, this);

    return latest;
  }

  /**
   * @method getLength
   * @param {string=} opt_trackName Optionally scope the lookup to a particular
   * track.
   * @return {number} The length of time in milliseconds that the actor
   * animates for.
   */
  getLength (opt_trackName) {
    return this.getEnd(opt_trackName) - this.getStart(opt_trackName);
  }

  /**
   * Extend the last state on this actor's timeline to simulate a pause.
   * Internally, this method copies the final state of the actor in the
   * timeline to the millisecond defined by `until`.
   *
   * __[Example](../../../../examples/actor_wait.html)__
   * @method wait
   * @param {number} until At what point in the animation the Actor should wait
   * until (relative to the start of the animation timeline).  If this number
   * is less than the value returned from `{{#crossLink
   * "Rekapi.Actor/getLength:method"}}{{/crossLink}}`, this method does
   * nothing.
   * @chainable
   */
  wait (until) {
    var length = this.getEnd();

    if (until <= length) {
      return this;
    }

    var end = this.getEnd();
    var latestProps = getLatestProperties(this, this.getEnd());
    var serializedProps = {};
    var serializedEasings = {};

    _.each(latestProps, function (latestProp, propName) {
      serializedProps[propName] = latestProp.value;
      serializedEasings[propName] = latestProp.easing;
    });

    this.modifyKeyframe(end, serializedProps, serializedEasings);
    this.keyframe(until, serializedProps, serializedEasings);

    return this;
  }

  /*!
   * Insert a `KeyframeProperty` into a property track at `index`.  The linked
   * list structure of the property track is maintained.
   * @method _insertKeyframePropertyAt
   * @param {Rekapi.KeyframeProperty} keyframeProperty
   * @param {Array(Rekapi.KeyframeProperty)} propertyTrack
   * @param {number} index
   */
  _insertKeyframePropertyAt (keyframeProperty, propertyTrack, index) {
    propertyTrack.splice(index, 0, keyframeProperty);
  }

  /*!
   * Remove the `KeyframeProperty` at `index` from a property track.  The linked
   * list structure of the property track is maintained.  The removed property
   * is not modified or unlinked internally.
   * @method _deleteKeyframePropertyAt
   * @param {Array(Rekapi.KeyframeProperty)} propertyTrack
   * @param {number} index
   */
  _deleteKeyframePropertyAt (propertyTrack, index) {
    propertyTrack.splice(index, 1);
  }

  /**
   * Associate a `{{#crossLink "Rekapi.KeyframeProperty"}}{{/crossLink}}` to
   * this actor.  Augments the `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}` to maintain a link between the
   * two objects.  This is a lower-level method, and it is generally better to
   * use `{{#crossLink "Rekapi.Actor/keyframe:method"}}{{/crossLink}}`.  This
   * is mostly useful for adding a `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}` back to an actor after it was
   * `{{#crossLink "Rekapi.KeyframeProperty/detach"}}{{/crossLink}}`ed.
   * @method addKeyframeProperty
   * @param {Rekapi.KeyframeProperty} keyframeProperty
   * @chainable
   */
  addKeyframeProperty (keyframeProperty) {
    if (this.rekapi) {
      fireEvent(this.rekapi, 'beforeAddKeyframeProperty', keyframeProperty);
    }

    keyframeProperty.actor = this;
    this._keyframeProperties[keyframeProperty.id] = keyframeProperty;

    var name = keyframeProperty.name;
    var propertyTracks = this._propertyTracks;

    if (typeof this._propertyTracks[name] === 'undefined') {
      propertyTracks[name] = [keyframeProperty];
      if (this.rekapi) {
        fireEvent(this.rekapi, 'addKeyframePropertyTrack', keyframeProperty);
      }
    } else {
      var index = insertionPointInTrack(propertyTracks[name], keyframeProperty.millisecond);
      if (propertyTracks[name][index]) {
        var ms = keyframeProperty.millisecond;
        var otherMs = propertyTracks[name][index].millisecond;
        if (otherMs === ms) {
          throw new Error('Tried to add a duplicate keyframe property, ' + name + ' @ ' + ms + ' ms');
        } else if (this.rekapi && this.rekapi._warnOnOutOfOrderKeyframes) {
          console.warn(new Error('Added a keyframe property before end of track, ' + name + ' @ ' + ms + ' ms < ' + otherMs + ' ms'));
        }
      }
      this._insertKeyframePropertyAt(keyframeProperty, propertyTracks[name], index);
      cleanupAfterKeyframeModification(this);
    }

    if (this.rekapi) {
      fireEvent(this.rekapi, 'addKeyframeProperty', keyframeProperty);
    }

    return this;
  }

  /*!
   * TODO: Explain the use case for this method
   * Set the actor to be active or inactive starting at `millisecond`.
   * @method setActive
   * @param {number} millisecond The time at which to change the actor's active state
   * @param {boolean} isActive Whether the actor should be active or inactive
   * @chainable
   */
  setActive (millisecond, isActive) {
    var activeProperty = this._propertyTracks._active
        && this.getKeyframeProperty('_active', millisecond);

    if (activeProperty) {
      activeProperty.value = isActive;
    } else {
      activeProperty = new KeyframeProperty(
        millisecond, '_active', isActive);
      this.addKeyframeProperty(activeProperty);
    }

    return this;
  }

  /*!
   * Calculate and set the actor's position at `millisecond` in the animation.
   * @method _updateState
   * @param {number} millisecond
   * @param {boolean=} opt_doResetLaterFnKeyframes If true, allow all function
   * keyframes later in the timeline to be run again.
   * @chainable
   */
  _updateState (millisecond, opt_doResetLaterFnKeyframes) {
    var startMs = this.getStart();
    var endMs = this.getEnd();
    var interpolatedObject = {};

    millisecond = Math.min(endMs, millisecond);

    ensurePropertyCacheValid(this);
    var propertiesToInterpolate =
        getPropertyCacheEntryForMillisecond(this, millisecond);

    // All actors are active at time 0 unless otherwise specified;
    // make sure a future time deactivation doesn't deactive the actor
    // by default.
    if (propertiesToInterpolate._active
        && millisecond >= propertiesToInterpolate._active.millisecond) {
      this.wasActive = propertiesToInterpolate._active.getValueAt(millisecond);
      if (!this.wasActive) {
        return this;
      }
    } else {
      this.wasActive = true;
    }

    if (startMs === endMs) {

      // If there is only one keyframe, use that for the state of the actor
      _.each(propertiesToInterpolate, function (keyframeProperty, propName) {
        if (propName !== '_millisecond') {
          if (keyframeProperty.shouldInvokeForMillisecond(millisecond)) {
            keyframeProperty.invoke();
            keyframeProperty.hasFired = false;
            return;
          }

          interpolatedObject[propName] = keyframeProperty.value;
        }
      }, this);

    } else {

      _.each(propertiesToInterpolate, function (keyframeProperty, propName) {
        if (propName !== '_millisecond') {
          if (this._beforeKeyframePropertyInterpolate !== noop) {
            this._beforeKeyframePropertyInterpolate(keyframeProperty);
          }

          if (keyframeProperty.shouldInvokeForMillisecond(millisecond)) {
            keyframeProperty.invoke();
            return;
          }

          interpolatedObject[propName] =
          keyframeProperty.getValueAt(millisecond);

          if (this._afterKeyframePropertyInterpolate !== noop) {
            this._afterKeyframePropertyInterpolate(
              keyframeProperty, interpolatedObject);
          }
        }
      }, this);
    }

    this.set(interpolatedObject);

    if (!opt_doResetLaterFnKeyframes) {
      this._resetFnKeyframesFromMillisecond(millisecond);
    }

    return this;
  }

  /*!
   * @method _resetFnKeyframesFromMillisecond
   * @param {number} millisecond
   */
  _resetFnKeyframesFromMillisecond (millisecond) {
    var cache = this._timelineFunctionCache;
    var index = _.sortedIndex(cache, { millisecond: millisecond }, getMillisecond);
    var len = cache.length;

    while (index < len) {
      cache[index++].hasFired = false;
    }
  }

  /*!
   * @method _beforeKeyframePropertyInterpolate
   * @param {Rekapi.KeyframeProperty} keyframeProperty
   * @abstract
   */
  _beforeKeyframePropertyInterpolate () {}

  /*!
   * @method _afterKeyframePropertyInterpolate
   * @param {Rekapi.KeyframeProperty} keyframeProperty
   * @param {Object} interpolatedObject
   * @abstract
   */
  _afterKeyframePropertyInterpolate () {}

  /**
   * __[Example](../../../../examples/actor_export_timeline.html)__
   * @method exportTimeline
   * @return {Object} A serializable Object of this actor's timeline property
   * tracks and `{{#crossLink "Rekapi.KeyframeProperty"}}{{/crossLink}}`s.
   */
  exportTimeline () {
    var exportData = {
      'start': this.getStart()
      ,'end': this.getEnd()
      ,'trackNames': this.getTrackNames()
      ,'propertyTracks': {}
    };

    _.each(this._propertyTracks, function (propertyTrack, trackName) {
      var trackAlias = exportData.propertyTracks[trackName] = [];
      _.each(propertyTrack, function (keyframeProperty) {
        trackAlias.push(keyframeProperty.exportPropertyData());
      });
    });

    return exportData;
  }

  /**
   * Import an Object to augment this actor's state.  This does not remove
   * keyframe properties before importing new ones.
   *
   * @method importTimeline
   * @param {Object} actorData Any object that has the same data format as the
   * object generated from `{{#crossLink
   * "Rekapi.Actor/exportTimeline:method"}}{{/crossLink}}`.
   */
  importTimeline (actorData) {
    _.each(actorData.propertyTracks, function (propertyTrack) {
      _.each(propertyTrack, function (property) {
        var obj = {};
        obj[property.name] = property.value;
        this.keyframe(property.millisecond, obj, property.easing);
      }, this);
    }, this);
  }
}
