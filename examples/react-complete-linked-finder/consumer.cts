import presentation = require('@miniextensions/sdk/react');
import coordination = require('@miniextensions/sdk/ui');

// Checked through the require-specific declaration export, without a DOM/client.
export const finder = presentation.CompleteLinkedFinder;
export const card = presentation.LinkedFinderCard;
export const cascade = presentation.NativeLinkedFinderCascade;
export const coordinator = coordination.createCompleteLinkedFinderCoordinator;
export const cascadeDriver = coordination.createNativeLinkedFinderCascadeDriver;
