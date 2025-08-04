/* tslint:disable */
/* eslint-disable */
// this is an auto generated file. This will be overwritten

import * as APITypes from "../API";
type GeneratedMutation<InputType, OutputType> = string & {
  __generatedMutationInput: InputType;
  __generatedMutationOutput: OutputType;
};

export const createLoginForm = /* GraphQL */ `mutation CreateLoginForm(
  $input: CreateLoginFormInput!
  $condition: ModelLoginFormConditionInput
) {
  createLoginForm(input: $input, condition: $condition) {
    id
    username
    password
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedMutation<
  APITypes.CreateLoginFormMutationVariables,
  APITypes.CreateLoginFormMutation
>;
export const updateLoginForm = /* GraphQL */ `mutation UpdateLoginForm(
  $input: UpdateLoginFormInput!
  $condition: ModelLoginFormConditionInput
) {
  updateLoginForm(input: $input, condition: $condition) {
    id
    username
    password
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedMutation<
  APITypes.UpdateLoginFormMutationVariables,
  APITypes.UpdateLoginFormMutation
>;
export const deleteLoginForm = /* GraphQL */ `mutation DeleteLoginForm(
  $input: DeleteLoginFormInput!
  $condition: ModelLoginFormConditionInput
) {
  deleteLoginForm(input: $input, condition: $condition) {
    id
    username
    password
    createdAt
    updatedAt
    __typename
  }
}
` as GeneratedMutation<
  APITypes.DeleteLoginFormMutationVariables,
  APITypes.DeleteLoginFormMutation
>;
export const createSNSAccount = /* GraphQL */ `mutation CreateSNSAccount(
  $input: CreateSNSAccountInput!
  $condition: ModelSNSAccountConditionInput
) {
  createSNSAccount(input: $input, condition: $condition) {
    id
    platform
    displayName
    accountId
    createdAt
    autoPost
    autoGenerate
    autoReply
    updatedAt
    owner
    __typename
  }
}
` as GeneratedMutation<
  APITypes.CreateSNSAccountMutationVariables,
  APITypes.CreateSNSAccountMutation
>;
export const updateSNSAccount = /* GraphQL */ `mutation UpdateSNSAccount(
  $input: UpdateSNSAccountInput!
  $condition: ModelSNSAccountConditionInput
) {
  updateSNSAccount(input: $input, condition: $condition) {
    id
    platform
    displayName
    accountId
    createdAt
    autoPost
    autoGenerate
    autoReply
    updatedAt
    owner
    __typename
  }
}
` as GeneratedMutation<
  APITypes.UpdateSNSAccountMutationVariables,
  APITypes.UpdateSNSAccountMutation
>;
export const deleteSNSAccount = /* GraphQL */ `mutation DeleteSNSAccount(
  $input: DeleteSNSAccountInput!
  $condition: ModelSNSAccountConditionInput
) {
  deleteSNSAccount(input: $input, condition: $condition) {
    id
    platform
    displayName
    accountId
    createdAt
    autoPost
    autoGenerate
    autoReply
    updatedAt
    owner
    __typename
  }
}
` as GeneratedMutation<
  APITypes.DeleteSNSAccountMutationVariables,
  APITypes.DeleteSNSAccountMutation
>;
