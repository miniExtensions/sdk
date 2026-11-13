import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    annotationPngFromDataUrl,
    openImageAnnotationMarkerEditor,
    type ImageAnnotationMarkerArea,
    type ImageAnnotationMarkerEvents,
    type ImageAnnotationMarkerModule,
} from '../src/react/imageAnnotationMarkerDriver.js';
import { createImageAnnotationSession } from '../src/react/imageAnnotationSession.js';

const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAgK0lEQVR4AQEgIN/fABSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP8AFIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/wAUgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/ABSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP8AFIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/wAUgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/ABSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP8AFIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/wAUgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/ABSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP8AFIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/wAUgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/ABSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP8AFIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/wAUgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/ABSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/FIK0/xSCtP8UgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP/cgrT/3IK0/9yCtP8AFCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/wAUKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/ABQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP8AFCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/wAUKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/ABQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP8AFCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/wAUKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/ABQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP8AFCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/wAUKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/ABQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP8AFCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/wAUKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/ABQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP8AFCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP8UKLT/FCi0/xQotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/9wotP/cKLT/3Ci0/wFBAS1eBtvUAAAAAElFTkSuQmCC';

function deferred<T>() {
    let resolve: (value: T) => void = () => { throw new Error('not initialized'); };
    let reject: (error: unknown) => void = () => { throw new Error('not initialized'); };
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function fixture(t: TestContext, throwingClose = false) {
    const window = new Window();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'HTMLButtonElement');
    Object.defineProperty(globalThis, 'HTMLButtonElement', {
        configurable: true, value: window.HTMLButtonElement,
    });
    const areas: Area[] = [];
    class Area implements ImageAnnotationMarkerArea {
        settings = { displayMode: '' };
        availableMarkerTypes: unknown[] = [];
        renderAtNaturalSize = false;
        renderImageType = '';
        renderImageQuality?: number;
        targetRoot = window.document.body as unknown as HTMLElement;
        styles = { classNamePrefixBase: 'annotation-base', classNamePrefix: 'annotation-test' };
        listeners = new Map<string, Set<unknown>>();
        detached = false;
        container = window.document.createElement('div');
        clicks = 0;
        constructor() { areas.push(this); }
        addEventListener<K extends keyof ImageAnnotationMarkerEvents>(
            type: K, listener: (event: ImageAnnotationMarkerEvents[K]) => void
        ) {
            let listeners = this.listeners.get(type);
            if (!listeners) { listeners = new Set(); this.listeners.set(type, listeners); }
            listeners.add(listener);
        }
        removeEventListener<K extends keyof ImageAnnotationMarkerEvents>(
            type: K, listener: (event: ImageAnnotationMarkerEvents[K]) => void
        ) { this.listeners.get(type)?.delete(listener); }
        emit(type: keyof ImageAnnotationMarkerEvents, event: unknown = {}) {
            for (const listener of [...(this.listeners.get(type) ?? [])]) {
                if (typeof listener === 'function') Reflect.apply(listener, undefined, [event]);
            }
        }
        show() {
            this.container.className = 'annotation-base annotation-test';
            this.container.innerHTML = '<div class="annotation-testtoolbar-button" data-type-name="ArrowMarker" title="Arrow"></div><a href="https://markerjs.com">Powered by marker.js</a>';
            this.container.querySelector('div')?.addEventListener('click', () => this.clicks++);
            window.document.body.append(this.container);
        }
        close() {
            // Retained vendor order: listeners run before final native detach.
            this.emit('close');
            this.detached = true;
            this.container.remove();
        }
    }
    const vendor: ImageAnnotationMarkerModule = {
        MarkerArea: Area,
        ArrowMarker: {}, CalloutMarker: {}, EllipseMarker: {}, FrameMarker: {},
        FreehandMarker: {}, HighlightMarker: {}, LineMarker: {}, TextMarker: {},
    };
    const upload = deferred<object>(), url = deferred<string>();
    let current = true, uploads = 0, reads = 0, appends = 0;
    const errors: unknown[] = [], releases: string[] = [];
    const session = createImageAnnotationSession({
        owner: { token: {}, isCurrent: () => current },
        storage: {
            createTemporaryPng() { uploads++; return upload.promise; },
            resolveUrl() { reads++; return url.promise; },
        },
        appendCurrent() { appends++; return 'appended'; },
        releaseObjectUrl: (source) => releases.push(source),
        onClose() { if (throwingClose) throw new Error('synthetic host close'); },
        onFailure(_phase, error) { errors.push(error); },
    });
    t.after(async () => {
        try { current = false; session.dispose(); } finally {
            if (descriptor) Object.defineProperty(globalThis, 'HTMLButtonElement', descriptor);
            else Reflect.deleteProperty(globalThis, 'HTMLButtonElement');
            await window.happyDOM.close();
        }
    });
    const lease = session.beginSource({ url: 'blob:owned', filename: 'source.jpg', ownedObjectUrl: true });
    assert.ok(lease);
    const image = window.document.createElement('img') as unknown as HTMLImageElement;
    return { window, vendor, areas, upload, url, session, lease, image,
        errors, releases, counts: () => ({ uploads, reads, appends }) };
}

it('late lazy-import completion after retirement constructs no editor', async (t) => {
    const f = fixture(t);
    const loading = deferred<ImageAnnotationMarkerModule>();
    const task = openImageAnnotationMarkerEditor({
        image: f.image, lease: f.lease,
        labels: { title: 'Annotation', moreTools: 'More tools' },
    }, () => loading.promise);
    f.session.clearSource();
    loading.resolve(f.vendor);
    await task;
    assert.equal(f.areas.length, 0);
    assert.deepEqual(f.counts(), { uploads: 0, reads: 0, appends: 0 });
    assert.deepEqual(f.releases, ['blob:owned']);
    assert.deepEqual(f.errors, []);
});

it('installs eight natural-size PNG tools with scoped localized keyboard semantics', async (t) => {
    const f = fixture(t);
    await openImageAnnotationMarkerEditor({
        image: f.image, lease: f.lease,
        labels: { title: 'Annoter', moreTools: 'Autres outils', tools: { ArrowMarker: 'Flèche' } },
    }, async () => f.vendor);
    const area = f.areas[0]; assert.ok(area);
    assert.equal(area.availableMarkerTypes.length, 8);
    assert.equal(area.settings.displayMode, 'popup');
    assert.equal(area.renderAtNaturalSize, true);
    assert.equal(area.renderImageType, 'image/png');
    assert.equal(area.renderImageQuality, 1);
    const button = area.container.querySelector('div'); assert.ok(button);
    assert.equal(button.getAttribute('aria-label'), 'Flèche');
    assert.equal(button.tabIndex, 0);
    button.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(area.clicks, 1);
    assert.equal(area.container.querySelector('a')?.href, 'https://markerjs.com/');
    assert.deepEqual(f.counts(), { uploads: 0, reads: 0, appends: 0 });
});

it('actual driver render-then-close preserves upload continuation and removes stale listeners', async (t) => {
    const f = fixture(t);
    await openImageAnnotationMarkerEditor({
        image: f.image, lease: f.lease,
        labels: { title: 'Annotation', moreTools: 'More tools' },
    }, async () => f.vendor);
    const area = f.areas[0]; assert.ok(area);
    area.emit('render', { dataUrl });
    area.emit('render', { dataUrl: 'invalid duplicate must be ignored' });
    assert.deepEqual(f.errors, []);
    area.close();
    area.emit('render', { dataUrl });
    assert.equal(area.detached, true);
    assert.equal(area.listeners.get('render')?.size ?? 0, 0);
    assert.equal(area.listeners.get('close')?.size ?? 0, 0);
    assert.equal(f.counts().uploads, 1);
    assert.deepEqual(f.releases, ['blob:owned']);
    f.upload.resolve({});
    await Promise.resolve();
    assert.equal(f.counts().reads, 1);
    f.url.resolve('https://synthetic.invalid/result.png');
    await Promise.resolve();
    assert.equal(f.counts().appends, 1);
    assert.deepEqual(f.errors, []);
});

it('throwing host close callback does not interrupt vendor detach', async (t) => {
    const f = fixture(t, true);
    await openImageAnnotationMarkerEditor({
        image: f.image, lease: f.lease,
        labels: { title: 'Annotation', moreTools: 'More tools' },
    }, async () => f.vendor);
    const area = f.areas[0]; assert.ok(area);
    assert.doesNotThrow(() => area.close());
    assert.equal(area.detached, true);
    assert.equal(f.errors.length, 1);
    assert.deepEqual(f.counts(), { uploads: 0, reads: 0, appends: 0 });
});

it('preserves authored PNG bytes without asserting decoder/canvas acceptance', async () => {
    const blob = annotationPngFromDataUrl(dataUrl);
    assert.equal(blob.type, 'image/png');
    assert.equal(blob.size, 8292);
    assert.deepEqual([...new Uint8Array(await blob.arrayBuffer()).slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

it('actual driver refuses malformed vendor output before any storage stage', async (t) => {
    assert.throws(() => annotationPngFromDataUrl('data:image/jpeg;base64,AAAA'));
    assert.throws(() => annotationPngFromDataUrl('data:image/png;base64,aGVsbG8='));
    const f = fixture(t);
    await openImageAnnotationMarkerEditor({
        image: f.image, lease: f.lease,
        labels: { title: 'Annotation', moreTools: 'More tools' },
    }, async () => f.vendor);
    const area = f.areas[0]; assert.ok(area);
    area.emit('render', { dataUrl: 'data:image/png;base64,aGVsbG8=' });
    assert.deepEqual(f.counts(), { uploads: 0, reads: 0, appends: 0 });
    assert.equal(f.errors.length, 1);
    assert.equal(area.detached, true);
    assert.deepEqual(f.releases, ['blob:owned']);
});


it('unmount disposal rejects a successfully settled lazy import without showing UI', async (t) => {
    const f = fixture(t);
    const loading = deferred<ImageAnnotationMarkerModule>();
    const task = openImageAnnotationMarkerEditor({
        image: f.image, lease: f.lease,
        labels: { title: 'Annotation', moreTools: 'More tools' },
    }, () => loading.promise);
    f.session.dispose();
    loading.resolve(f.vendor);
    await task;
    assert.equal(f.areas.length, 0);
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.releases, ['blob:owned']);
});

it('late lazy import rejection after unmount publishes no stale feedback', async (t) => {
    const f = fixture(t);
    const loading = deferred<ImageAnnotationMarkerModule>();
    const task = openImageAnnotationMarkerEditor({
        image: f.image, lease: f.lease,
        labels: { title: 'Annotation', moreTools: 'More tools' },
    }, () => loading.promise);
    f.session.dispose();
    loading.reject(new Error('synthetic late loader failure'));
    await task;
    assert.equal(f.areas.length, 0);
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.counts(), { uploads: 0, reads: 0, appends: 0 });
});
