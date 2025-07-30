import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { DebriefingData } from '@/components/channel-chat/DebriefingModal';

export interface Debriefing {
  id: string;
  title: string;
  description: string;
  video_url: string;
  creator_id: string;
  creator_username: string;
  likes: number;
  isLiked: boolean;
  created_at: string;
  channel_id: string;
}

export const useDebriefings = (channelId: string | null) => {
  const { user } = useAuth();
  const [debriefings, setDebriefings] = useState<Debriefing[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDebriefings = async () => {
    setLoading(true);
    
    try {
      if (!channelId || channelId === 'general') {
        // Pour les débriefings généraux ou quand pas de channel spécifique
        setDebriefings([]);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('debriefings')
        .select('*')
        .eq('channel_id', channelId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const debriefingsWithUserInfo = await Promise.all(
        (data || []).map(async (debriefing) => {
          // Get creator username
          const { data: profileData } = await supabase
            .from('profiles')
            .select('username')
            .eq('user_id', debriefing.creator_id)
            .single();

          // Check if user has liked this debriefing
          const { data: likeData } = await supabase
            .from('debriefing_likes')
            .select('id')
            .eq('debriefing_id', debriefing.id)
            .eq('user_id', user?.id)
            .maybeSingle();

          return {
            ...debriefing,
            creator_username: profileData?.username || 'Utilisateur',
            isLiked: !!likeData
          };
        })
      );

      setDebriefings(debriefingsWithUserInfo);
    } catch (error) {
      console.error('Error fetching debriefings:', error);
      toast.error('Erreur lors du chargement des débriefings');
    } finally {
      setLoading(false);
    }
  };

  const createDebriefing = async (debriefingData: DebriefingData & { channelId?: string }) => {
    if (!user) {
      toast.error('Vous devez être connecté pour créer un débriefing');
      return false;
    }

    if (!channelId || channelId === 'general') {
      toast.error('Sélectionnez un canal valide pour créer un débriefing');
      return false;
    }

    try {
      let videoUrl = '';
      
      if (debriefingData.video) {
        // Upload video to storage
        const videoFileName = `${user.id}/${Date.now()}-${debriefingData.video.name}`;
        
        const { error: uploadError } = await supabase.storage
          .from('debriefing-videos')
          .upload(videoFileName, debriefingData.video);

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('debriefing-videos')
          .getPublicUrl(videoFileName);
        
        videoUrl = urlData.publicUrl;
      }

      // Create debriefing in database
      const { data, error } = await supabase
        .from('debriefings')
        .insert({
          title: debriefingData.title,
          description: debriefingData.description,
          video_url: videoUrl,
          creator_id: user.id,
          channel_id: channelId
        })
        .select()
        .single();

      if (error) throw error;

      // Get creator username
      const { data: profileData } = await supabase
        .from('profiles')
        .select('username')
        .eq('user_id', user.id)
        .single();

      const newDebriefing: Debriefing = {
        ...data,
        creator_username: profileData?.username || 'Vous',
        isLiked: false
      };

      // Add to the beginning of the list (newest first)
      setDebriefings(prev => [newDebriefing, ...prev]);
      
      toast.success('Débriefing créé avec succès !');
      return true;
    } catch (error) {
      console.error('Error creating debriefing:', error);
      toast.error('Erreur lors de la création du débriefing');
      return false;
    }
  };

  const likeDebriefing = async (debriefingId: string) => {
    if (!user) {
      toast.error('Vous devez être connecté pour liker');
      return false;
    }

    try {
      const debriefing = debriefings.find(d => d.id === debriefingId);
      if (!debriefing) return false;

      if (debriefing.isLiked) {
        // Remove like
        const { error } = await supabase
          .from('debriefing_likes')
          .delete()
          .eq('debriefing_id', debriefingId)
          .eq('user_id', user.id);

        if (error) throw error;
      } else {
        // Add like
        const { error } = await supabase
          .from('debriefing_likes')
          .insert({
            debriefing_id: debriefingId,
            user_id: user.id
          });

        if (error) throw error;
      }

      // Update local state
      setDebriefings(prev => prev.map(d => {
        if (d.id === debriefingId) {
          return {
            ...d,
            isLiked: !d.isLiked,
            likes: d.isLiked ? d.likes - 1 : d.likes + 1
          };
        }
        return d;
      }));
      
      return true;
    } catch (error) {
      console.error('Error liking debriefing:', error);
      toast.error('Erreur lors du like');
      return false;
    }
  };

  const deleteDebriefing = async (debriefingId: string) => {
    if (!user) {
      toast.error('Vous devez être connecté pour supprimer');
      return false;
    }

    try {
      // Delete from database
      const { error } = await supabase
        .from('debriefings')
        .delete()
        .eq('id', debriefingId)
        .eq('creator_id', user.id);

      if (error) throw error;

      // Update local state
      setDebriefings(prev => prev.filter(d => d.id !== debriefingId));
      toast.success('Débriefing supprimé avec succès');
      return true;
    } catch (error) {
      console.error('Error deleting debriefing:', error);
      toast.error('Erreur lors de la suppression');
      return false;
    }
  };

  useEffect(() => {
    if (channelId && channelId !== 'general') {
      fetchDebriefings();
    } else {
      setDebriefings([]);
      setLoading(false);
    }
  }, [channelId]);

  return {
    debriefings,
    loading,
    createDebriefing,
    likeDebriefing,
    deleteDebriefing,
    refetch: fetchDebriefings
  };
};