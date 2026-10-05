import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    getLoginVerificationDestination,
    shouldMaskLoginFieldInput,
} from '../src/auth/index.js';
import {
    AirtableFieldType,
    type LoginPageResult,
} from '../src/runtime/index.js';
import { loginPage, verificationSent } from './authFixtures.js';

const field = (
    phone = false
): {
    page: LoginPageResult;
    schema: LoginPageResult['payload']['fieldNamesToSchemas'][string];
} => {
    const page = loginPage();
    const schema: LoginPageResult['payload']['fieldNamesToSchemas'][string] =
        phone
            ? {
                  fieldType: AirtableFieldType.PHONE_NUMBER,
                  airtableField: {
                      id: 'fld_phone',
                      name: 'Phone',
                      description: null,
                      isComputed: false,
                      isPrimaryField: true,
                      config: {
                          type: AirtableFieldType.PHONE_NUMBER,
                          options: null,
                      },
                  },
              }
            : {
                  fieldType: AirtableFieldType.EMAIL,
                  airtableField: {
                      id: 'fld_email',
                      name: 'Email',
                      description: null,
                      isComputed: false,
                      isPrimaryField: true,
                      config: { type: AirtableFieldType.EMAIL, options: null },
                  },
              };
    page.payload.loginFieldNames = [schema.airtableField.name];
    page.payload.loginFieldIds = [schema.airtableField.id];
    page.payload.fieldNamesToSchemas = { [schema.airtableField.name]: schema };
    page.payload.fieldIdsToSchemas = { [schema.airtableField.id]: schema };
    return { page, schema };
};

describe('hosted login presentation rules', () => {
    it('uses a nonblank configured visible title, falls back to the field name, and respects hidden titles', () => {
        const { schema } = field();
        schema.airtableField.name = 'Portal PIN';
        assert.equal(shouldMaskLoginFieldInput(schema), true);
        schema.miniExtConfig = { title: 'Ordinary credential' };
        assert.equal(shouldMaskLoginFieldInput(schema), false);
        schema.miniExtConfig = { title: '  ' };
        assert.equal(shouldMaskLoginFieldInput(schema), true);
        schema.miniExtConfig = { title: 'Account password', showTitle: false };
        assert.equal(shouldMaskLoginFieldInput(schema), false);
        schema.miniExtConfig = {
            maskPasswordOnLoginScreen: true,
            showTitle: false,
        };
        assert.equal(shouldMaskLoginFieldInput(schema), true);
        assert.equal(shouldMaskLoginFieldInput(undefined), false);
    });

    it('masks only an explicitly masked field with the matching configured verification mode', () => {
        const { page, schema } = field();
        const verification = verificationSent();
        schema.miniExtConfig = {
            title: 'Password',
            requireEmailVerificationToLogin: true,
        };
        assert.equal(
            getLoginVerificationDestination(page, verification),
            verification.emailOrPhoneNumber
        );
        const phone = field(true).schema;
        schema.miniExtConfig = { maskPasswordOnLoginScreen: true };
        phone.miniExtConfig = { requirePhoneNumberVerificationToLogin: true };
        page.payload.loginFieldNames.push('Phone');
        page.payload.loginFieldIds.push(phone.airtableField.id);
        page.payload.fieldNamesToSchemas.Phone = phone;
        page.payload.fieldIdsToSchemas[phone.airtableField.id] = phone;
        const phoneVerification = {
            ...verification,
            verificationType: 'phoneNumber' as const,
            emailOrPhoneNumber: '+15550102030',
        };
        assert.equal(
            getLoginVerificationDestination(page, phoneVerification),
            phoneVerification.emailOrPhoneNumber
        );
        phone.miniExtConfig = { maskPasswordOnLoginScreen: true };
        schema.miniExtConfig = {
            maskPasswordOnLoginScreen: true,
            requireEmailVerificationToLogin: true,
        };
        assert.equal(
            getLoginVerificationDestination(page, verification),
            '••••••••'
        );
        page.payload.loginFieldNames = [];
        assert.equal(
            getLoginVerificationDestination(page, verification),
            verification.emailOrPhoneNumber
        );
    });

    it('keeps a supplied fallback destination visible without changing the original challenge', () => {
        const { page, schema } = field(true);
        schema.miniExtConfig = {
            maskPasswordOnLoginScreen: true,
            requirePhoneNumberVerificationToLogin: true,
        };
        const verification = {
            ...verificationSent(),
            verificationType: 'phoneNumber' as const,
            emailOrPhoneNumber: '+15550102030',
        };
        const original = structuredClone(verification);
        assert.equal(
            getLoginVerificationDestination(page, verification),
            '••••••••'
        );
        assert.equal(
            getLoginVerificationDestination(page, verification, {
                fallbackPhoneVerificationNumber: '+15550102030',
            }),
            '+15550102030'
        );
        assert.deepEqual(verification, original);
    });
});
