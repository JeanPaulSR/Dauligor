import React, { useState, useRef } from 'react';
import { storage } from '../../lib/firebase';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { Button } from './button';
import { Upload, X, Loader2, Image as ImageIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ImageUploadProps {
  onUpload: (url: string) => void;
  storagePath: string; // e.g., 'images/lore/${id}/'
  currentImageUrl?: string;
  className?: string;
}

export function ImageUpload({ onUpload, storagePath, currentImageUrl, className }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file within 5MB.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be less than 5MB.');
      return;
    }

    setError(null);
    setUploading(true);
    setProgress(0);

    try {
      const extension = file.name.split('.').pop() || 'jpg';
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${extension}`;
      const filePath = `${storagePath.endsWith('/') ? storagePath : storagePath + '/'}${fileName}`;
      const storageRef = ref(storage, filePath);

      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progressPercent = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setProgress(progressPercent);
        },
        (error) => {
          console.error("Upload error:", error);
          setError(error.message);
          setUploading(false);
        },
        () => {
          getDownloadURL(uploadTask.snapshot.ref).then((downloadURL) => {
            onUpload(downloadURL);
            setUploading(false);
            setProgress(0);
          });
        }
      );
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during upload.');
      setUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUpload(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div 
        className={cn(
          "border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center transition-colors relative overflow-hidden text-center",
          currentImageUrl ? "border-gold/30 bg-card/30" : "border-border hover:border-gold/50 bg-background/50 hover:bg-card/50",
          uploading && "opacity-50 pointer-events-none"
        )}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {currentImageUrl ? (
          <div className="relative w-full">
            <img 
              src={currentImageUrl} 
              alt="Uploaded file" 
              className="max-h-64 object-contain rounded-md w-full mx-auto"
              referrerPolicy="no-referrer"
            />
            <Button 
              type="button"
              variant="destructive" 
              size="icon" 
              className="absolute top-2 right-2 rounded-full shadow-lg"
              onClick={(e) => {
                e.stopPropagation();
                onUpload("");
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-gold/10 flex items-center justify-center">
              <ImageIcon className="h-6 w-6 text-gold" />
            </div>
            <div>
              <p className="text-sm font-medium text-ink">
                Drag and drop an image, or click to browse
              </p>
              <p className="text-xs text-ink/50 mt-1">
                PNG, JPG, WEBP up to 5MB
              </p>
            </div>
            <Button 
              type="button" 
              variant="outline" 
              className="border-gold/20 hover:bg-gold/10 gap-2"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4" /> Choose File
            </Button>
          </div>
        )}
        
        {uploading && (
          <div className="absolute inset-0 bg-background/80 flex flex-col items-center justify-center p-4">
            <Loader2 className="h-8 w-8 animate-spin text-gold mb-4" />
            <div className="w-full max-w-xs bg-muted rounded-full h-2.5">
              <div 
                className="bg-gold h-2.5 rounded-full transition-all duration-300" 
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <span className="text-xs font-medium text-ink mt-2">Uploading... {Math.round(progress)}%</span>
          </div>
        )}

        {/* Hidden File Input allowing browsing */}
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileChange} 
          accept="image/*" 
          className="hidden" 
        />
      </div>

      {error && <p className="text-sm text-destructive font-medium">{error}</p>}
    </div>
  );
}
