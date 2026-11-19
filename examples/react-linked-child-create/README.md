# Create linked record in a React Form

Import `LinkedChildCreateAction` from `main.ts` into a React host that already owns a top-level Form. Supply the linked-child owner returned by `fields.linkedChild(fieldId, recovery)`, the current parent check, and the existing child field renderer. Keep the action mounted on the same parent installation and retain the actual Create button across ordinary renders.

The action explicitly opens the child. The installed `FormLinkedChildCreateDialog` borrows its one-page field bindings and page owner, keeps focus inside the native dialog, and uses the existing linked-child Save. Form validation and the parent link update run through that same owner. Dirty dismissal asks for confirmation before calling the owner's Close, and focus returns only to the original trigger if its opening still belongs to the current parent.
