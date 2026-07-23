export {};

interface MexConfigListaModelo {
  nombre?: string;
  imagenURL?: string;
  imagen?: string;
  image?: string;
  foto?: string;
}

interface MexConfigListas {
  modelos?: MexConfigListaModelo[];
  gasolinas?: Array<string | { nombre?: string; valor?: string; id?: string }>;
}

interface MexConfigGlobal {
  empresa?: { tipoNegocio?: string; [key: string]: unknown };
  listas?: MexConfigListas;
  profile?: Record<string, unknown>;
  [key: string]: unknown;
}

interface FirebaseAuthUserLike {
  uid?: string;
  email?: string;
  displayName?: string;
}

interface FirebaseAuthGlobal {
  currentUser: FirebaseAuthUserLike | null;
}

interface MexPermsGlobal {
  canDo(permissionKey: string): boolean;
}

interface MexUnidadesGlobal {
  isReady?(): boolean;
  buscar?(query: string, limit: number): unknown[];
}

declare global {
  interface Window {
    firebase: any;
    _auth: FirebaseAuthGlobal;
    _db: any;
    _empresaActual: { tipoNegocio?: string; [key: string]: unknown } | null;
    MEX_CONFIG: MexConfigGlobal;
    __mexCurrentUserRecord: { nombre?: string; [key: string]: unknown } | null;
    mexPerms: MexPermsGlobal;
    mexUnidades?: MexUnidadesGlobal;
    mexAlert(titulo: string, texto: string, tipo?: string): Promise<unknown>;
    mexConfirm(titulo: string, texto: string, tipo?: string): Promise<boolean>;
    mexPrompt(
      titulo: string,
      texto: string,
      placeholder?: string,
      inputTipo?: string,
      valor?: string
    ): Promise<string | null>;
  }
}
