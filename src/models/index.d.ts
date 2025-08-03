import { ModelInit, MutableModel, __modelMeta__, ManagedIdentifier } from "@aws-amplify/datastore";
// @ts-ignore
import { LazyLoading, LazyLoadingDisabled } from "@aws-amplify/datastore";





type EagerLoginForm = {
  readonly [__modelMeta__]: {
    identifier: ManagedIdentifier<LoginForm, 'id'>;
    readOnlyFields: 'createdAt' | 'updatedAt';
  };
  readonly id: string;
  readonly username?: string | null;
  readonly password?: string | null;
  readonly createdAt?: string | null;
  readonly updatedAt?: string | null;
}

type LazyLoginForm = {
  readonly [__modelMeta__]: {
    identifier: ManagedIdentifier<LoginForm, 'id'>;
    readOnlyFields: 'createdAt' | 'updatedAt';
  };
  readonly id: string;
  readonly username?: string | null;
  readonly password?: string | null;
  readonly createdAt?: string | null;
  readonly updatedAt?: string | null;
}

export declare type LoginForm = LazyLoading extends LazyLoadingDisabled ? EagerLoginForm : LazyLoginForm

export declare const LoginForm: (new (init: ModelInit<LoginForm>) => LoginForm) & {
  copyOf(source: LoginForm, mutator: (draft: MutableModel<LoginForm>) => MutableModel<LoginForm> | void): LoginForm;
}